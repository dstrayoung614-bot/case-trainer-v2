import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { checkRateLimit } from '@/app/lib/rate-limit';
import { satCases } from '@/app/lib/sat-cases';

export const dynamic = 'force-dynamic';

// Отдельный rate limiter для SAT: 3 полных прохождения в час
const SAT_WINDOW_MS = 60 * 60 * 1000;
const SAT_MAX = 3;
const satStore = new Map<string, { count: number; resetAt: number }>();

function checkSatRateLimit(ip: string): { allowed: boolean; remaining: number; resetInMinutes: number } {
  const now = Date.now();
  const entry = satStore.get(ip);
  if (!entry || now > entry.resetAt) {
    satStore.set(ip, { count: 1, resetAt: now + SAT_WINDOW_MS });
    return { allowed: true, remaining: SAT_MAX - 1, resetInMinutes: 60 };
  }
  if (entry.count >= SAT_MAX) {
    const resetInMinutes = Math.ceil((entry.resetAt - now) / 60_000);
    return { allowed: false, remaining: 0, resetInMinutes };
  }
  entry.count += 1;
  return { allowed: true, remaining: SAT_MAX - entry.count, resetInMinutes: Math.ceil((entry.resetAt - now) / 60_000) };
}

type SatSubmission = {
  caseId: number;
  answer: string;
};

type SatRequestBody = {
  submissions: SatSubmission[];
};

const RUBRIC_PROMPT = `
Ты — поддерживающий эксперт по оценке продуктового мышления. Твоя цель — честно оценить ответ и мотивировать кандидата развиваться дальше.
Целевая аудитория: студенты и начинающие специалисты. Оценивай относительно уровня стажёра/джуниора — даже частичный правильный ответ заслуживает признания.

Шкала 0–5:
- 0 = бессмыслица, случайные символы, текст не по теме
- 1 = есть осмысленный текст, но критерий почти не раскрыт
- 2 = слабая попытка, есть зерно правильного мышления
- 3 = приемлемый ответ: кандидат понимает суть, но не хватает глубины
- 4 = хороший ответ с конкретикой и логикой — типичный уровень джуниора+
- 5 = образцовый ответ

6 критериев:
- problemFraming (0-5): понимание сути проблемы, границ, контекста
- diagnosis (0-5): гипотезы о причинах, логика проверки
- metricsThinking (0-5): конкретные метрики, north star, guardrails
- prioritization (0-5): логика порядка действий, impact/effort
- clarityStructure (0-5): читаемость, структура, связность
- tradeOffs (0-5): риски, компромиссы, митигация
`;

function buildSatPrompt(submissions: { caseTitle: string; caseDescription: string; answer: string }[]): string {
  let prompt = 'Оцени ответы кандидата на 3 мини-кейса экспресс-диагностики.\n\n';

  for (let i = 0; i < submissions.length; i++) {
    prompt += `--- МИНИ-КЕЙС ${i + 1}: ${submissions[i].caseTitle} ---\n`;
    prompt += `Условие: ${submissions[i].caseDescription}\n\n`;
    prompt += `Ответ кандидата:\n${submissions[i].answer}\n\n`;
  }

  prompt += `Верни JSON строго в таком формате (без markdown, без комментариев):
{
  "caseScores": [
    {
      "caseId": 1,
      "scores": { "problemFraming": N, "diagnosis": N, "metricsThinking": N, "prioritization": N, "clarityStructure": N, "tradeOffs": N },
      "brief": "Краткий комментарий к ответу (1-2 предложения)"
    },
    { "caseId": 2, ... },
    { "caseId": 3, ... }
  ],
  "overallScores": { "problemFraming": N, "diagnosis": N, "metricsThinking": N, "prioritization": N, "clarityStructure": N, "tradeOffs": N },
  "strongAreas": ["название сильной зоны 1", "название сильной зоны 2"],
  "weakAreas": ["название слабой зоны 1", "название слабой зоны 2"],
  "recommendation": "Общая рекомендация: что улучшить в первую очередь (2-3 предложения)"
}

overallScores — это агрегированная оценка по всем 3 кейсам (взвешенная с учётом того, какие кейсы какие критерии проверяют).
strongAreas — критерии с оценкой >= 3.5 (используй русские названия).
weakAreas — критерии с оценкой < 2.5 (используй русские названия). Не показывай больше 2 слабых зон — выбери самые важные.`;

  return prompt;
}

export type SatResponse = {
  caseScores: {
    caseId: number;
    scores: Record<string, number>;
    brief: string;
  }[];
  overallScores: Record<string, number>;
  strongAreas: string[];
  weakAreas: string[];
  recommendation: string;
};

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? req.headers.get('x-real-ip') ?? 'unknown';
    const rl = checkSatRateLimit(ip);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: `rate_limit:${rl.resetInMinutes}` },
        { status: 429 },
      );
    }

    const body: SatRequestBody = await req.json();

    if (!body.submissions || body.submissions.length !== 3) {
      return NextResponse.json({ error: 'Expected exactly 3 submissions' }, { status: 400 });
    }

    for (const sub of body.submissions) {
      if (!sub.answer || sub.answer.trim().length < 30) {
        return NextResponse.json({ error: `Answer for case ${sub.caseId} is too short (min 30 chars)` }, { status: 400 });
      }
    }

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      return NextResponse.json(getMockSatResponse(), { status: 200 });
    }

    const submissions = body.submissions.map((sub) => {
      const satCase = satCases.find((c) => c.id === sub.caseId);
      return {
        caseTitle: satCase?.title ?? `Case ${sub.caseId}`,
        caseDescription: satCase?.description ?? '',
        answer: sub.answer.slice(0, 3000),
      };
    });

    const client = new OpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey,
      defaultHeaders: {
        'HTTP-Referer': 'https://case-trainer.app',
        'X-Title': 'CaseTrainer SAT',
      },
    });

    const completion = await client.chat.completions.create({
      model: process.env.OPENROUTER_MODEL ?? 'google/gemini-2.0-flash-001',
      temperature: 0.3,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: RUBRIC_PROMPT },
        { role: 'user', content: buildSatPrompt(submissions) },
      ],
    });

    const raw = completion.choices[0]?.message?.content ?? '{}';
    let parsed: SatResponse;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return NextResponse.json(getMockSatResponse(), { status: 200 });
    }

    // Validate shape
    if (!parsed.overallScores || !parsed.caseScores) {
      return NextResponse.json(getMockSatResponse(), { status: 200 });
    }

    return NextResponse.json(parsed, { status: 200 });
  } catch (err) {
    console.error('[SAT API]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

function getMockSatResponse(): SatResponse {
  return {
    caseScores: [
      { caseId: 1, scores: { problemFraming: 3, diagnosis: 3, metricsThinking: 2, prioritization: 2, clarityStructure: 3, tradeOffs: 2 }, brief: 'Проблема обозначена, но гипотезы поверхностные.' },
      { caseId: 2, scores: { problemFraming: 2, diagnosis: 2, metricsThinking: 3, prioritization: 3, clarityStructure: 3, tradeOffs: 2 }, brief: 'Метрики выбраны, но не хватает guardrails.' },
      { caseId: 3, scores: { problemFraming: 2, diagnosis: 2, metricsThinking: 2, prioritization: 2, clarityStructure: 3, tradeOffs: 3 }, brief: 'Риски названы, структура неплохая.' },
    ],
    overallScores: { problemFraming: 2.3, diagnosis: 2.3, metricsThinking: 2.3, prioritization: 2.3, clarityStructure: 3.0, tradeOffs: 2.3 },
    strongAreas: ['Структура и ясность'],
    weakAreas: ['Постановка проблемы', 'Метрики', 'Риски и компромиссы'],
    recommendation: 'Сфокусируйтесь на формулировке проблемы — чётко определяйте границы и контекст. Добавляйте конкретные метрики вместо общих слов.',
  };
}
