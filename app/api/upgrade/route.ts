import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';
import { UpgradeRequest, UpgradeResponse } from '@/app/lib/types';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body: UpgradeRequest = await req.json();

    if (!body.originalSolution || body.originalSolution.trim().length < 10) {
      return NextResponse.json({ error: 'Solution is too short' }, { status: 400 });
    }

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      return NextResponse.json(getMockUpgrade(body), { status: 200 });
    }

    const client = new OpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey,
      defaultHeaders: {
        'HTTP-Referer': 'https://case-trainer.app',
        'X-Title': 'CaseTrainer',
      },
    });
    const scoresText = Object.entries(body.feedback.scores)
      .map(([k, v]) => `${k}: ${v}/5`)
      .join(', ');

    const prompt = `Ты — опытный продуктовый наставник. Твоя задача — улучшить КОНКРЕТНЫЙ ответ студента, а НЕ написать идеальный ответ с нуля.

ВАЖНО: Для блоков, которые студент заполнил — расширяй, уточняй и исправляй его мысли. Для пустых блоков '[не заполнено студентом]' — напиши сильный вариант на основе кейса и фидбека.

===КЕЙС===
Название: ${body.caseTitle}
Сложность: ${body.difficulty}
Фокус: ${body.skillFocus.join(', ')}
Описание: ${body.caseDescription}

===ОТВЕТ СТУДЕНТА===
${body.originalSolution}

===ПОЛУЧЕННЫЙ ФИДБЕК===
Оценки: ${scoresText}
Проблемы: ${body.feedback.issues.map((i) => `[${i.dimension}] ${i.issue}`).join('; ')}
Топ-3 улучшения: ${body.feedback.topFixes.join('; ')}

===ПРАВИЛА===
1. Сохраняй все правильные мысли студента — не убирай то, что уже хорошо.
2. Улучшай формулировки студента, а не заменяй их своими.
3. Добавляй конкретику туда, где студент был расплывчат.
4. Если студент упустил важный блок — добавь его коротко.
5. upgradedSolution должен читаться как доработанная версия ответа студента.
6. Для блоков помеченных '[не заполнено студентом]' — напиши сильный вариант на основе кейса и фидбека.
7. keyLessons ОБЯЗАТЕЛЬНО должен содержать ровно 3 конкретных урока из ошибок этого ответа.

Отвечай ТОЛЬКО в JSON:
{
  "upgradedSolution": "<улучшенная версия ответа студента, markdown>",
  "changes": [
    {
      "section": "<название раздела/блока>",
      "original": "<точная цитата или краткое описание того, что написал студент>",
      "improved": "<как именно это улучшено>",
      "explanation": "<почему это делает ответ сильнее на интервью>"
    }
  ],
  "keyLessons": [
    "<ключевой урок 1 из ошибок этого студента>",
    "<ключевой урок 2>",
    "<ключевой урок 3>"
  ]
}

Изменений 3-6, уроков 3. Ссылайся на конкретные слова студента.`;

    const completion = await client.chat.completions.create({
      model: process.env.OPENROUTER_MODEL ?? 'google/gemini-2.0-flash-001',
      temperature: 0.4,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'Ты продуктовый наставник, который помогает студентам улучшить их ответы на кейс-интервью. Ты конкретен, обучаешь на примерах, объясняешь логику. Отвечай строго в JSON.',
        },
        { role: 'user', content: prompt },
      ],
    });

    const raw = completion.choices[0].message.content ?? '{}';

    // Repair JSON: only escape control chars that appear INSIDE string values
    function repairJson(s: string): string {
      let out = '';
      let inStr = false;
      let esc = false;
      for (const ch of s) {
        if (esc) { out += ch; esc = false; continue; }
        if (ch === '\\') { esc = true; out += ch; continue; }
        if (ch === '"') { inStr = !inStr; out += ch; continue; }
        if (inStr) {
          if (ch === '\n') { out += '\\n'; continue; }
          if (ch === '\r') { out += '\\r'; continue; }
          if (ch === '\t') { out += '\\t'; continue; }
        }
        out += ch;
      }
      return out;
    }

    let parsed: UpgradeResponse;
    try {
      parsed = JSON.parse(repairJson(raw)) as UpgradeResponse;
    } catch {
      // Second attempt: extract JSON block if model wrapped it in markdown
      const match = raw.match(/\{[\s\S]*\}/);
      if (!match) throw new Error(`Bad JSON from AI: ${raw.slice(0, 200)}`);
      parsed = JSON.parse(repairJson(match[0])) as UpgradeResponse;
    }

    if (!parsed.upgradedSolution || !parsed.changes) {
      throw new Error('Invalid AI response structure');
    }
    if (!parsed.keyLessons || parsed.keyLessons.length === 0) {
      parsed.keyLessons = [
        'Структурируйте ответ по всем 5 блокам даже если не уверены',
        'Конкретные метрики сильнее общих слов',
        'Всегда называйте риски и компромиссы решения',
      ];
    }

    return NextResponse.json(parsed, { status: 200 });
  } catch (err) {
    console.error('[upgrade] error:', err);
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function getMockUpgrade(body: UpgradeRequest): UpgradeResponse {
  return {
    isMock: true,
    upgradedSolution: `## 1. Уточнение / границы проблемы
Нужно сфокусироваться на конкретном периоде и сегменте. Например: retention упал в когорте пользователей, привлечённых через paid-каналы в последние 3 месяца.

## 2. Диагностика / гипотезы (приоритизированные)

**Гипотеза 1 (наиболее вероятная):** Ухудшение качества трафика из paid-каналов после масштабирования рекламы.
- Проверить: retention по каналам привлечения vs. предыдущий период.

**Гипотеза 2:** Продуктовое изменение, ухудшившее core loop для существующей аудитории.
- Проверить: когортный retention до/после последнего крупного релиза.

**Гипотеза 3:** Сезонность / разовая аномалия.
- Проверить: YoY-сравнение, исключить праздники.

## 3. Метрики для проверки
- **D1/D7/D30 retention** по когортам (неделя привлечения × канал)
- **DAU/MAU** в разрезе acquisition channel
- **Time to first value** — как быстро новые пользователи доходят до ключевого действия
- **Churn reason** — exit survey / session recording для ушедших

## 4. Приоритизированные действия
1. Немедленно: когортный анализ retention по каналам (данные есть, быстро)
2. Если гипотеза 1 подтвердилась: пересмотреть targeting / bid strategy в paid
3. Если гипотеза 2: A/B тест откатить изменение или feature flag
4. Запустить exit survey для пользователей, не вернувшихся после D7

## 5. Риски и компромиссы
- Ограничение paid-трафика снизит MAU краткосрочно, но улучшит LTV
- При откате продуктового изменения нужно зафиксировать learning: почему оно не сработало`,
    changes: [
      {
        section: 'Диагностика',
        original: 'Перечислены гипотезы без приоритизации',
        improved:
          'Гипотезы расставлены по вероятности с конкретным способом проверки каждой',
        explanation:
          'На интервью важно показать, что вы не перебираете все варианты подряд, а думаете о том, с чего начать — это признак системного мышления',
      },
      {
        section: 'Метрики',
        original: 'Указаны только агрегированные метрики (MAU, retention)',
        improved: 'Добавлены сегментированные метрики: retention по когортам × каналам, time to first value',
        explanation:
          'Агрегат скрывает проблему. Сегментация позволяет сразу выдвинуть проверяемую гипотезу о причине',
      },
      {
        section: 'Приоритизация действий',
        original: 'Список действий без логики порядка',
        improved: 'Явная логика: сначала данные (дёшево, быстро), потом эксперимент',
        explanation:
          'Кандидаты, которые сначала лезут в эксперименты, не проверив гипотезу данными — это красный флаг на интервью',
      },
    ],
    keyLessons: [
      'Всегда начинай диагностику с сегментации, а не с агрегата — проблема прячется в разрезах',
      'Каждая гипотеза должна быть проверяемой: укажи конкретную метрику и критерий подтверждения',
      'Приоритизируй шаги по скорости и дешевизне проверки: сначала данные, потом эксперимент',
    ],
  };
}
