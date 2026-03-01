import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { AnalyzeRequest, FeedbackResponse } from '@/app/lib/types';

export const dynamic = 'force-dynamic';

const RUBRIC_DIMENSIONS = `
- problemFraming (1-5): чёткость определения проблемы и её границ
  1=нет понимания, 2=размыто, 3=понятно но неполно, 4=чётко с контекстом, 5=идеально структурировано
- diagnosis (1-5): глубина анализа причин и гипотез
  1=нет гипотез, 2=1-2 поверхностно, 3=3-4 разумных, 4=5+ с приоритизацией, 5=исчерпывающе со структурой
- metricsThinking (1-5): качество выбора метрик
  1=нет метрик, 2=1-2 общих, 3=конкретные но неполные, 4=north star + leading + guardrails, 5=идеально с обоснованием
- prioritization (1-5): логика приоритизации действий
  1=нет, 2=упомянуто без критериев, 3=есть критерии, 4=явные impact/effort/risk, 5=исчерпывающе с обоснованием
- clarityStructure (1-5): структура и ясность изложения
  1=хаотично, 2=слабо структурировано, 3=понятно, 4=хорошо структурировано, 5=образцово чётко
- tradeOffs (1-5): учёт рисков и компромиссов
  1=нет, 2=1-2 общих, 3=конкретные риски, 4=риски + способы митигации, 5=исчерпывающий анализ
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
          content: `Ты — опытный коуч по кейс-интервью. Твоя задача — дать честную и конструктивную обратную связь.

Принципы оценки:
- Оценивай то, ЧТО ЕСТЬ в ответе, а не ищи то, чего нет
- Если кандидат разобрал 4-5 гипотез — это 4-5, даже если одна редкая гипотеза не упомянута
- Балл снижается только за реальные системные пробелы, а не за отсутствие одного частного случая
- Хороший структурированный ответ с конкретными метриками и приоритизацией заслуживает 4-5
- Не придумывай проблемы ради придумывания — если ответ сильный, так и скажи

Отвечай строго в формате JSON, следуя заданной схеме. Будь конкретным, используй примеры из ответа.`,
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

Будь конкретным — используй цитаты и примеры из ответа пользователя.
Укажи 2-3 реальные сильные стороны.
Если ответ сильный — укажи 1-2 точки роста максимум. Если слабый — до 4.
НЕ придумывай проблемы ради заполнения списка.
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
