import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { AnalyzeRequest, FeedbackResponse } from '@/app/lib/types';

export const dynamic = 'force-dynamic';

const RUBRIC_DIMENSIONS = `
- problemFraming (1-5): насколько чётко определена проблема и её границы
- diagnosis (1-5): глубина анализа причин, правильность гипотез
- metricsThinking (1-5): качество выбора метрик, их релевантность
- prioritization (1-5): логика приоритизации, явные критерии выбора
- clarityStructure (1-5): структурированность и читаемость ответа
- tradeOffs (1-5): учёт рисков и компромиссов
`;

export async function POST(req: NextRequest) {
  try {
    const body: AnalyzeRequest = await req.json();

    if (!body.solution || body.solution.trim().length < 50) {
      return NextResponse.json(
        { error: 'Solution is too short' },
        { status: 400 }
      );
    }

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      return NextResponse.json(getMockFeedback(body), { status: 200 });
    }

    const client = new OpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey,
      defaultHeaders: {
        'HTTP-Referer': 'https://case-trainer.app',
        'X-Title': 'CaseTrainer',
      },
    });
    const prompt = buildPrompt(body);

    const completion = await client.chat.completions.create({
      model: process.env.OPENROUTER_MODEL ?? 'google/gemini-2.0-flash-001',
      temperature: 0.4,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `Ты — эксперт по продуктовому мышлению и коуч по кейс-интервью. 
Ты даёшь структурированную обратную связь по решениям продуктовых кейсов.
Отвечай строго в формате JSON, следуя заданной схеме.
Будь конкретным, избегай общих фраз. Основная цель — помочь кандидату улучшить структуру мышления.`,
        },
        { role: 'user', content: prompt },
      ],
    });

    const raw = completion.choices[0].message.content ?? '{}';
    const parsed = JSON.parse(raw) as FeedbackResponse;

    if (!parsed.scores || !parsed.topFixes) {
      throw new Error('Invalid AI response structure');
    }

    return NextResponse.json(parsed, { status: 200 });
  } catch (err) {
    console.error('[analyze] error:', err);
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function buildPrompt(body: AnalyzeRequest): string {
  return `
Кейс: "${body.caseTitle}"
Сложность: ${body.difficulty}
Фокус навыков: ${body.skillFocus.join(', ')}

Описание кейса:
${body.caseDescription}

Ответ пользователя:
${body.solution}

Самооценка пользователя:
- Уверенность: ${body.selfReview.confidence}/5
- Что вызвало сомнения: "${body.selfReview.uncertainArea}"

Оцени ответ по следующей рубрике (каждый критерий от 1 до 5):
${RUBRIC_DIMENSIONS}

Верни ТОЛЬКО JSON следующей структуры:
{
  "scores": {
    "problemFraming": <number 1-5>,
    "diagnosis": <number 1-5>,
    "metricsThinking": <number 1-5>,
    "prioritization": <number 1-5>,
    "clarityStructure": <number 1-5>,
    "tradeOffs": <number 1-5>
  },
  "strengths": ["<конкретная сильная сторона>", ...],
  "issues": [
    {
      "dimension": "<название критерия>",
      "issue": "<конкретная проблема в ответе>",
      "whyItMatters": "<почему это важно на интервью>"
    },
    ...
  ],
  "topFixes": ["<конкретное действие 1>", "<конкретное действие 2>", "<конкретное действие 3>"],
  "nextIterationPrompt": "<конкретное задание для следующей итерации, 1-2 предложения>",
  "disclaimer": "Это тренировочная обратная связь по структуре и логике мышления. Единственно правильного ответа не существует."
}

Будь конкретным — используй примеры из ответа пользователя. Укажи не менее 2 сильных сторон и 2-4 проблем.
`;
}

function getMockFeedback(body: AnalyzeRequest): FeedbackResponse {
  return {
    isMock: true,
    scores: {
      problemFraming: 0,
      diagnosis: 0,
      metricsThinking: 0,
      prioritization: 0,
      clarityStructure: 0,
      tradeOffs: 0,
    },
    strengths: [],
    issues: [],
    topFixes: [
      'Добавьте ваш OpenRouter API ключ в настройках (кнопка ⚙ в правом нижнем углу)',
      'Получить ключ можно на openrouter.ai/settings/keys',
      'Выберите модель и нажмите Сохранить',
    ],
    nextIterationPrompt:
      `Чтобы получить реальный фидбек по кейсу "${body.caseTitle}", добавьте OpenRouter API ключ в настройках.`,
    disclaimer:
      'Демо-режим: оценки недоступны без API ключа. Нажмите ⚙ в правом нижнем углу, чтобы добавить ключ.',
  };
}
