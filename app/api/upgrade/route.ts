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

    if (!body.apiKey) {
      return NextResponse.json(getMockUpgrade(body), { status: 200 });
    }

    const client = new OpenAI({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: body.apiKey,
      defaultHeaders: {
        'HTTP-Referer': 'https://case-trainer.app',
        'X-Title': 'CaseTrainer',
      },
    });
    const scoresText = Object.entries(body.feedback.scores)
      .map(([k, v]) => `${k}: ${v}/5`)
      .join(', ');

    const prompt = `Ты — опытный продуктовый наставник. Студент решал кейс и получил фидбек. Твоя задача: взять ответ студента и доработать его до уровня сильного кандидата на PM-позицию, объяснив каждое улучшение.

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

===ЗАДАЧА===
1. Перепиши ответ студента до уровня "сильный кандидат". Сохрани структуру, где она правильная. Добавь то, чего не хватало. Улучши то, что было слабым.
2. Для каждого ключевого улучшения опиши: что именно изменилось, как было у студента, как стало.

Отвечай ТОЛЬКО в JSON:
{
  "upgradedSolution": "<полный улучшенный ответ, markdown>",
  "changes": [
    {
      "section": "<название раздела/блока>",
      "original": "<что было у студента (цитата или краткое описание)>",
      "improved": "<что изменилось (1-2 предложения с примером)>",
      "explanation": "<почему это делает ответ сильнее на реальном интервью>"
    }
  ],
  "keyLessons": [
    "<ключевой урок 1 для запоминания>",
    "<ключевой урок 2>",
    "<ключевой урок 3>"
  ]
}

Изменений должно быть 3-6, уроков — 3. Будь конкретным, ссылайся на кейс.`;

    const completion = await client.chat.completions.create({
      model: body.model,
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
    const parsed = JSON.parse(raw) as UpgradeResponse;

    if (!parsed.upgradedSolution || !parsed.changes) {
      throw new Error('Invalid AI response structure');
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
