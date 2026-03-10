import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { AnalyzeRequest, FeedbackResponse } from '@/app/lib/types';
import { checkRateLimit } from '@/app/lib/rate-limit';

export const dynamic = 'force-dynamic';

const RUBRIC_DIMENSIONS = `
Целевая аудитория: студенты и начинающие специалисты без опыта работы в продукте. Оценивай относительно уровня стажёра/джуниора, а не Senior PM.

ВАЖНО: Шкала от 0 до 5. 0 — это не «плохо», это «отсутствует или бессмысленно».
Если текст в любом критерии — случайный набор символов, бессмыслица, пустота или не имеет отношения к кейсу — ставь 0, не 1.

- problemFraming (0-5): понимание сути проблемы
  0=бессмыслица, случайные символы, текст не имеет отношения к задаче, 1=не понял задачу вообще, 2=очень размыто, есть хоть какое-то понимание темы, 3=суть схвачена, даже если не идеально сформулирована, 4=чётко с контекстом, 5=структурировано с ограничениями
- diagnosis (0-5): наличие гипотез о причинах
  0=бессмыслица или полное отсутствие, 1=нет осмысленных гипотез вообще, 2=1 поверхностная гипотеза, 3=2-3 логичных гипотезы, 4=4+ с попыткой приоритизации, 5=системный анализ с обоснованием
- metricsThinking (0-5): упоминание метрик
  0=бессмыслица или полное отсутствие, 1=нет метрик вообще, 2=только общие слова («смотреть статистику»), 3=1-2 конкретные метрики названы, 4=несколько метрик с логикой выбора, 5=метрики + воронка + guardrails
- prioritization (0-5): логика порядка действий
  0=бессмыслица или полное отсутствие, 1=нет никакого порядка, 2=перечислены шаги без логики, 3=есть последовательность с хоть каким-то «почему», 4=явные критерии приоритизации, 5=impact/effort/risk с обоснованием
- clarityStructure (0-5): читаемость и структура
  0=бессмыслица, случайные символы, нечитаемый текст, 1=хаотично, непонятно, но хоть что-то есть, 2=есть попытка структуры, читается с трудом, 3=понятный связный ответ, 4=чёткие блоки с переходами, 5=образцово структурировано
- tradeOffs (0-5): учёт рисков или компромиссов
  0=бессмыслица или полное отсутствие, 1=нет вообще, 2=упомянут 1 риск формально, 3=1-2 реальных риска названы, 4=риски + митигация, 5=полный анализ компромиссов
`;

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? req.headers.get('x-real-ip') ?? 'unknown';
    const rl = checkRateLimit(ip);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: `rate_limit:${rl.resetInMinutes}` },
        { status: 429 }
      );
    }

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
          content: `Ты — строгий, но справедливый эксперт по оценке ответов на кейс-интервью для продакт-менеджеров.

Правила оценки:
- Шкала 0-5. 0 означает «бессмыслица, случайные символы, или текст полностью не относится к кейсу».
- Если текст — случайный набор букв/символов (например «аолуадлуалд») — ставь 0 по ВСЕМ критериям без исключения.
- 1 — есть хоть какой-то осмысленный текст по теме, но критерий не раскрыт вообще.
- 2 — есть попытка, но очень слабая и поверхностная.
- 3 — приемлемый уровень для стажёра/джуниора.
- 4-5 — только за действительно сильные ответы с конкретикой, метриками, логикой.
- НЕ накручивай баллы. Плохой ответ должен получать 0-1, не 2-3.
- Оценивай то, что написано, а не то, что могло бы быть написано.

Отвечай строго в формате JSON, следуя заданной схеме. Будь конкретным, используй примеры из ответа.`,
        },
        { role: 'user', content: prompt },
      ],
    });

    const rawContent = completion.choices[0].message.content ?? '{}';
    const jsonMatch = rawContent.match(/```(?:json)?\s*([\s\S]*?)```/);
    const rawJson = jsonMatch ? jsonMatch[1] : rawContent;
    const sanitized = rawJson
      .replace(/\\(?!["\\/bfnrtu])/g, '\\\\')
      .replace(/[\u0000-\u001F\u007F]/g, (c) => {
        const safe: Record<string, string> = { '\n': '\\n', '\r': '\\r', '\t': '\\t' };
        return safe[c] ?? '';
      });
    let parsed: FeedbackResponse;
    try {
      parsed = JSON.parse(sanitized) as FeedbackResponse;
    } catch {
      const aggressive = rawJson.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\\(?!["\\/bfnrtu])/g, '/');
      parsed = JSON.parse(aggressive) as FeedbackResponse;
    }

    if (!parsed.scores || !parsed.topFixes) {
      throw new Error('Invalid AI response structure');
    }

    // Гарантируем ровно 3 topFixes — AI иногда возвращает меньше
    const TOPFIXES_FALLBACKS = [
      'Добавьте явную приоритизацию: объясните, почему выбрали именно этот шаг первым',
      'Назовите конкретные метрики для проверки ключевой гипотезы',
      'Укажите хотя бы один компромисс или риск предложенного решения',
    ];
    while (parsed.topFixes.length < 3) {
      const fallback = TOPFIXES_FALLBACKS[parsed.topFixes.length];
      parsed.topFixes.push(fallback ?? 'Проработайте следующий слабый критерий из оценки выше');
    }
    if (parsed.topFixes.length > 3) {
      parsed.topFixes = parsed.topFixes.slice(0, 3);
    }

    // Гарантируем: каждый критерий с баллом ≤ 2 должен быть в issues.
    // Clamp: оценки должны быть в диапазоне 0-5
    for (const key of Object.keys(parsed.scores) as (keyof typeof parsed.scores)[]) {
      parsed.scores[key] = Math.max(0, Math.min(5, parsed.scores[key]));
    }
    // Это защита от AI-лимита «не более 4 пунктов».
    const DIMENSION_FALLBACKS: Record<string, { label: string; whyItMatters: string }> = {
      problemFraming:   { label: 'Формулировка проблемы',  whyItMatters: 'Без чёткого определения проблемы невозможно двигаться дальше — интервьюер должен видеть, что вы понимаете задачу.' },
      diagnosis:        { label: 'Диагностика',            whyItMatters: 'Гипотезы о причинах — ключевой этап анализа; без них решение будет поверхностным.' },
      metricsThinking:  { label: 'Метрики',                whyItMatters: 'Правильные метрики показывают системное мышление и умение измерять влияние решений.' },
      prioritization:   { label: 'Приоритизация',          whyItMatters: 'Обоснование приоритетов демонстрирует понимание impact/effort/risk и зрелость продуктового мышления.' },
      clarityStructure: { label: 'Структура и ясность',   whyItMatters: 'Чёткая структура помогает интервьюеру следить за ходом мысли и оценивать логику кандидата.' },
      tradeOffs:        { label: 'Компромиссы и риски',   whyItMatters: 'Учёт рисков и trade-offs отличает опытного продакта от джуниора — реальные решения всегда содержат компромиссы.' },
    };

    const normalise = (s: string) => s.toLowerCase().replace(/[\s_-]/g, '');
    const coveredDimensions = new Set(
      (parsed.issues ?? []).map((iss) => normalise(iss.dimension))
    );

    const fallbackIssues: typeof parsed.issues = [];
    for (const [dimKey, meta] of Object.entries(DIMENSION_FALLBACKS)) {
      const score = (parsed.scores as Record<string, number>)[dimKey] ?? 5;
      if (score <= 2 && !coveredDimensions.has(normalise(dimKey)) && !coveredDimensions.has(normalise(meta.label))) {
        fallbackIssues.push({
          dimension: dimKey,
          issue: `Критерий «${meta.label}» не раскрыт в ответе (оценка: ${score}/5).`,
          whyItMatters: meta.whyItMatters,
        });
      }
    }

    if (fallbackIssues.length > 0) {
      parsed.issues = [...(parsed.issues ?? []), ...fallbackIssues];
    }

    // Code-override: принудительно ставим 1 для секций, которые были пусты.
    // Это защита от AI, который игнорирует маркер [не заполнено студентом].
    const SECTION_TO_SCORE_KEY: Record<string, keyof typeof parsed.scores> = {
      'формулировка проблемы': 'problemFraming',
      'гипотезы':              'diagnosis',
      'метрики':               'metricsThinking',
      'действия':              'prioritization',
      'риски':                 'tradeOffs',
    };
    const solutionLower = body.solution.toLowerCase();
    for (const [sectionName, scoreKey] of Object.entries(SECTION_TO_SCORE_KEY)) {
      // Ищем паттерн "## <section>\n[не заполнено студентом]"
      const marker = `## ${sectionName}\n[не заполнено студентом]`;
      if (solutionLower.includes(marker)) {
        parsed.scores[scoreKey] = 0;
      }
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
    "problemFraming": <number 0-5>,
    "diagnosis": <number 0-5>,
    "metricsThinking": <number 0-5>,
    "prioritization": <number 0-5>,
    "clarityStructure": <number 0-5>,
    "tradeOffs": <number 0-5>
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
  "disclaimer": "Это тренировочная обратная связь по структуре и логике мышления. Единственного правильного ответа не существует."
}

Будь конкретным — используй цитаты и примеры из ответа пользователя.
Укажи 2-3 реальные сильные стороны.
Если ответ сильный — укажи 1-2 точки роста. Если слабый — укажи КАЖДЫЙ критерий с баллом 0-2, без ограничения по количеству.
НЕ придумывай проблемы ради заполнения списка.
topFixes — СТРОГО ровно 3 пункта, не больше и не меньше. Каждый — конкретное действие, привязанное к этому ответу.

ВАЖНО: Если раздел ответа содержит текст "[не заполнено студентом]" — это означает, что студент не написал ничего в этом блоке. Оценка за соответствующий критерий ОБЯЗАТЕЛЬНО должна быть 0.
ВАЖНО: Если весь ответ или его часть — случайный набор символов без смысла — ставь 0 по всем затронутым критериям.
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
