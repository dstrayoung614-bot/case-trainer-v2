'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import { motion, AnimatePresence, type Variants } from 'framer-motion';
import { satCases, SAT_RUBRIC_LABELS, RUBRIC_TO_CASES } from '../lib/sat-cases';
import { CompetencyRadar } from '../components/radar-chart';
import { cases } from '../lib/cases';
import { track } from '../lib/analytics';
import type { SatResponse } from '../api/sat/route';

// ─── types ───────────────────────────────────────────────────────────────────

type Step = 'intro' | 'case-1' | 'case-2' | 'case-3' | 'loading' | 'results';

const STEP_ORDER: Step[] = ['intro', 'case-1', 'case-2', 'case-3'];

// ─── animation ───────────────────────────────────────────────────────────────

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 20 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.08, duration: 0.35, ease: 'easeOut' as const },
  }),
};

const slideVariants: Variants = {
  enter: { opacity: 0, x: 40 },
  center: { opacity: 1, x: 0, transition: { duration: 0.3, ease: 'easeOut' } },
  exit: { opacity: 0, x: -40, transition: { duration: 0.2 } },
};

// ─── helpers ─────────────────────────────────────────────────────────────────

function SimpleMarkdown({ text }: { text: string }) {
  const lines = text.split('\n');
  return (
    <div className="space-y-2 text-sm text-gray-700 leading-relaxed">
      {lines.map((line, i) => {
        if (!line.trim()) return <br key={i} />;
        // bold
        const parts = line.split(/\*\*(.+?)\*\*/g);
        return (
          <p key={i}>
            {parts.map((part, j) =>
              j % 2 === 1 ? (
                <strong key={j} className="font-semibold text-gray-900">
                  {part}
                </strong>
              ) : (
                part
              ),
            )}
          </p>
        );
      })}
    </div>
  );
}

function ProgressBar({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-3">
      {Array.from({ length: total }).map((_, i) => (
        <div key={i} className="flex items-center">
          <div
            className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
              i < current
                ? 'bg-indigo-600 text-white'
                : i === current
                ? 'bg-indigo-100 text-indigo-700 ring-2 ring-indigo-500'
                : 'bg-gray-100 text-gray-400'
            }`}
          >
            {i < current ? '✓' : i + 1}
          </div>
          {i < total - 1 && (
            <div className={`w-8 h-0.5 mx-1 ${i < current ? 'bg-indigo-600' : 'bg-gray-200'}`} />
          )}
        </div>
      ))}
    </div>
  );
}

// ─── main page ───────────────────────────────────────────────────────────────

export default function SATPage() {
  const [step, setStep] = useState<Step>('intro');
  const [answers, setAnswers] = useState<Record<number, string>>({});
  const [result, setResult] = useState<SatResponse | null>(null);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const currentCaseIndex = step.startsWith('case-') ? parseInt(step.split('-')[1]) - 1 : -1;
  const currentCase = currentCaseIndex >= 0 ? satCases[currentCaseIndex] : null;

  const handleStart = useCallback(() => {
    track('sat_started' as Parameters<typeof track>[0]);
    setStep('case-1');
  }, []);

  const handleNext = useCallback(() => {
    if (!currentCase) return;

    const answer = answers[currentCase.id] ?? '';
    if (answer.trim().length < 30) {
      setError('Напишите хотя бы 30 символов');
      return;
    }
    setError('');

    track('sat_case_submitted' as Parameters<typeof track>[0], {
      meta: { caseId: currentCase.id, caseTitle: currentCase.title },
    });

    const nextIndex = currentCaseIndex + 1;
    if (nextIndex < satCases.length) {
      setStep(`case-${nextIndex + 1}` as Step);
    } else {
      submitAll();
    }
  }, [currentCase, currentCaseIndex, answers]);

  const submitAll = useCallback(async () => {
    setStep('loading');
    setIsSubmitting(true);

    try {
      const submissions = satCases.map((c) => ({
        caseId: c.id,
        answer: answers[c.id] ?? '',
      }));

      const res = await fetch('/api/sat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ submissions }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (typeof data.error === 'string' && data.error.startsWith('rate_limit:')) {
          const mins = data.error.split(':')[1];
          setError(`Превышен лимит запросов. Попробуйте через ${mins} мин.`);
        } else {
          setError(data.error || 'Ошибка сервера');
        }
        setStep('case-3');
        setIsSubmitting(false);
        return;
      }

      const data: SatResponse = await res.json();
      setResult(data);
      setStep('results');

      track('sat_completed' as Parameters<typeof track>[0], {
        meta: {
          overallScores: data.overallScores,
          strongAreas: data.strongAreas,
          weakAreas: data.weakAreas,
        },
      });
    } catch {
      setError('Не удалось получить результат. Проверьте подключение.');
      setStep('case-3');
    } finally {
      setIsSubmitting(false);
    }
  }, [answers]);

  const handleRestart = useCallback(() => {
    setAnswers({});
    setResult(null);
    setError('');
    setStep('intro');
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-indigo-50">
      {/* Header */}
      <header className="border-b border-gray-100 bg-white/70 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link href="/" className="text-sm text-gray-400 hover:text-gray-600 transition-colors">
            ← CaseTrainer
          </Link>
          <span className="text-xs font-semibold text-indigo-600 uppercase tracking-wide">
            SAT — Экспресс-диагностика
          </span>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-10">
        <AnimatePresence mode="wait">
          {/* ─── INTRO ─── */}
          {step === 'intro' && (
            <motion.div
              key="intro"
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              className="space-y-8 text-center"
            >
              <motion.div className="space-y-3" initial="hidden" animate="visible" custom={0} variants={fadeUp}>
                <div className="inline-flex items-center gap-2 bg-indigo-100 text-indigo-700 text-xs font-semibold px-3 py-1.5 rounded-full">
                  <span>🎯</span>
                  <span>~13 минут · 3 мини-кейса · без регистрации</span>
                </div>
                <h1 className="text-3xl font-bold text-gray-900">
                  Экспресс-диагностика навыков
                </h1>
                <p className="text-gray-600 max-w-md mx-auto leading-relaxed">
                  Узнайте свои сильные и слабые стороны в продуктовых кейсах.
                  AI оценит ваш ответ по 6 критериям и подскажет, что улучшить.
                </p>
              </motion.div>

              <motion.div
                className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-left"
                initial="hidden"
                animate="visible"
                custom={1}
                variants={fadeUp}
              >
                {satCases.map((c, i) => (
                  <div
                    key={c.id}
                    className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 space-y-2"
                  >
                    <div className="flex items-center gap-2">
                      <span className="bg-indigo-600 text-white text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center">
                        {i + 1}
                      </span>
                      <span className="text-xs text-gray-400">{c.estimatedMinutes} мин</span>
                    </div>
                    <p className="text-sm font-semibold text-gray-800">{c.title}</p>
                    <p className="text-xs text-indigo-600">{c.hint}</p>
                  </div>
                ))}
              </motion.div>

              <motion.div initial="hidden" animate="visible" custom={2} variants={fadeUp}>
                <button
                  onClick={handleStart}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-4 px-10 rounded-xl transition-colors text-lg shadow-md"
                >
                  Начать диагностику →
                </button>
              </motion.div>
            </motion.div>
          )}

          {/* ─── CASE STEP ─── */}
          {currentCase && (
            <motion.div
              key={step}
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              className="space-y-6"
            >
              <div className="flex items-center justify-between">
                <ProgressBar current={currentCaseIndex} total={satCases.length} />
                <span className="text-xs text-gray-400">
                  ~{currentCase.estimatedMinutes} мин
                </span>
              </div>

              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-bold text-gray-900">
                    {currentCase.title}
                  </h2>
                  <span className="text-xs bg-indigo-50 text-indigo-600 font-medium px-2 py-1 rounded-full">
                    {currentCase.hint}
                  </span>
                </div>

                <SimpleMarkdown text={currentCase.description} />
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">
                  Ваш ответ
                </label>
                <textarea
                  value={answers[currentCase.id] ?? ''}
                  onChange={(e) =>
                    setAnswers((prev) => ({ ...prev, [currentCase.id]: e.target.value }))
                  }
                  placeholder="Пишите здесь..."
                  rows={8}
                  className="w-full rounded-xl border border-gray-200 p-4 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent resize-y"
                />
                <div className="flex items-center justify-between">
                  <span className="text-xs text-gray-400">
                    {(answers[currentCase.id] ?? '').length} символов
                  </span>
                  {error && (
                    <span className="text-xs text-red-500">{error}</span>
                  )}
                </div>
              </div>

              <div className="flex gap-3">
                {currentCaseIndex > 0 && (
                  <button
                    onClick={() => {
                      setError('');
                      setStep(`case-${currentCaseIndex}` as Step);
                    }}
                    className="px-5 py-3 rounded-xl border border-gray-200 text-gray-600 text-sm font-medium hover:bg-gray-50 transition-colors"
                  >
                    ← Назад
                  </button>
                )}
                <button
                  onClick={handleNext}
                  className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3 rounded-xl transition-colors shadow-sm"
                >
                  {currentCaseIndex === satCases.length - 1
                    ? 'Получить результат →'
                    : 'Далее →'}
                </button>
              </div>
            </motion.div>
          )}

          {/* ─── LOADING ─── */}
          {step === 'loading' && (
            <motion.div
              key="loading"
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              className="text-center py-20 space-y-4"
            >
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-indigo-100">
                <motion.div
                  className="w-8 h-8 border-3 border-indigo-600 border-t-transparent rounded-full"
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                />
              </div>
              <p className="text-gray-600 font-medium">AI анализирует ваши ответы...</p>
              <p className="text-xs text-gray-400">Обычно занимает 10-20 секунд</p>
            </motion.div>
          )}

          {/* ─── RESULTS ─── */}
          {step === 'results' && result && (
            <motion.div
              key="results"
              variants={slideVariants}
              initial="enter"
              animate="center"
              exit="exit"
              className="space-y-8"
            >
              {/* Header */}
              <motion.div className="text-center space-y-2" initial="hidden" animate="visible" custom={0} variants={fadeUp}>
                <h1 className="text-2xl font-bold text-gray-900">Результат диагностики</h1>
                <p className="text-sm text-gray-500">
                  Средний балл:{' '}
                  <span className="font-bold text-indigo-600">
                    {(
                      Object.values(result.overallScores).reduce((a, b) => a + b, 0) /
                      Object.values(result.overallScores).length
                    ).toFixed(1)}
                  </span>
                  {' '}/ 5
                </p>
              </motion.div>

              {/* Radar */}
              <motion.div
                className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6"
                initial="hidden"
                animate="visible"
                custom={1}
                variants={fadeUp}
              >
                <h3 className="text-sm font-semibold text-gray-700 mb-3">Профиль навыков</h3>
                <CompetencyRadar scores={result.overallScores} height={260} />
              </motion.div>

              {/* Scores breakdown */}
              <motion.div
                className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-3"
                initial="hidden"
                animate="visible"
                custom={2}
                variants={fadeUp}
              >
                <h3 className="text-sm font-semibold text-gray-700">Оценки по критериям</h3>
                {Object.entries(result.overallScores).map(([key, value]) => (
                  <div key={key} className="flex items-center gap-3">
                    <span className="text-xs text-gray-600 w-40 flex-shrink-0">
                      {SAT_RUBRIC_LABELS[key] ?? key}
                    </span>
                    <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                      <motion.div
                        className={`h-full rounded-full ${
                          value >= 4 ? 'bg-emerald-500' : value >= 3 ? 'bg-amber-400' : 'bg-red-400'
                        }`}
                        initial={{ width: 0 }}
                        animate={{ width: `${(value / 5) * 100}%` }}
                        transition={{ duration: 0.7, ease: 'easeOut', delay: 0.3 }}
                      />
                    </div>
                    <span className="text-xs font-bold text-gray-700 w-8 text-right">
                      {typeof value === 'number' ? value.toFixed(1) : value}
                    </span>
                  </div>
                ))}
              </motion.div>

              {/* Strong / Weak areas */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {result.strongAreas.length > 0 && (
                  <motion.div
                    className="bg-emerald-50 rounded-2xl border border-emerald-100 p-5 space-y-2"
                    initial="hidden"
                    animate="visible"
                    custom={3}
                    variants={fadeUp}
                  >
                    <h3 className="text-sm font-semibold text-emerald-700">✅ Сильные стороны</h3>
                    <ul className="space-y-1">
                      {result.strongAreas.map((a, i) => (
                        <li key={i} className="text-sm text-emerald-700">• {a}</li>
                      ))}
                    </ul>
                  </motion.div>
                )}
                {result.weakAreas.length > 0 && (
                  <motion.div
                    className="bg-amber-50 rounded-2xl border border-amber-100 p-5 space-y-2"
                    initial="hidden"
                    animate="visible"
                    custom={3}
                    variants={fadeUp}
                  >
                    <h3 className="text-sm font-semibold text-amber-700">🎯 Зоны роста</h3>
                    <ul className="space-y-1">
                      {result.weakAreas.map((a, i) => (
                        <li key={i} className="text-sm text-amber-700">• {a}</li>
                      ))}
                    </ul>
                  </motion.div>
                )}
              </div>

              {/* Per-case briefs */}
              <motion.div
                className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4"
                initial="hidden"
                animate="visible"
                custom={4}
                variants={fadeUp}
              >
                <h3 className="text-sm font-semibold text-gray-700">Комментарии по кейсам</h3>
                {result.caseScores.map((cs) => {
                  const satCase = satCases.find((c) => c.id === cs.caseId);
                  return (
                    <div key={cs.caseId} className="border-l-2 border-indigo-200 pl-4 space-y-1">
                      <p className="text-sm font-medium text-gray-800">
                        {satCase?.title ?? `Кейс ${cs.caseId}`}
                      </p>
                      <p className="text-xs text-gray-500">{cs.brief}</p>
                    </div>
                  );
                })}
              </motion.div>

              {/* Recommendation */}
              <motion.div
                className="bg-indigo-50 rounded-2xl border border-indigo-100 p-5 space-y-2"
                initial="hidden"
                animate="visible"
                custom={5}
                variants={fadeUp}
              >
                <h3 className="text-sm font-semibold text-indigo-700">💡 Рекомендация</h3>
                <p className="text-sm text-indigo-700 leading-relaxed">{result.recommendation}</p>
              </motion.div>

              {/* Recommended cases */}
              <RecommendedCases weakAreas={result.weakAreas} overallScores={result.overallScores} />

              {/* CTAs */}
              <motion.div
                className="flex flex-col sm:flex-row gap-3"
                initial="hidden"
                animate="visible"
                custom={7}
                variants={fadeUp}
              >
                <Link
                  href="/"
                  className="flex-1 text-center bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3 rounded-xl transition-colors shadow-sm"
                >
                  Начать тренировку →
                </Link>
                <button
                  onClick={handleRestart}
                  className="flex-1 text-center px-5 py-3 rounded-xl border border-gray-200 text-gray-600 text-sm font-medium hover:bg-gray-50 transition-colors"
                >
                  Пройти ещё раз
                </button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}

// ─── recommended cases block ─────────────────────────────────────────────────

function RecommendedCases({
  weakAreas,
  overallScores,
}: {
  weakAreas: string[];
  overallScores: Record<string, number>;
}) {
  // Find rubric keys that scored low
  const weakKeys = Object.entries(overallScores)
    .filter(([, v]) => v < 3)
    .sort(([, a], [, b]) => a - b)
    .map(([k]) => k);

  if (weakKeys.length === 0) return null;

  // Collect recommended case IDs (deduplicated, max 6)
  const seen = new Set<number>();
  const recommended: typeof cases[number][] = [];
  for (const key of weakKeys) {
    const ids = RUBRIC_TO_CASES[key] ?? [];
    for (const id of ids) {
      if (!seen.has(id) && recommended.length < 6) {
        const c = cases.find((cc) => cc.id === id);
        if (c) {
          seen.add(id);
          recommended.push(c);
        }
      }
    }
  }

  if (recommended.length === 0) return null;

  const DIFFICULTY_LABELS: Record<string, string> = { easy: 'Лёгкий', medium: 'Средний', hard: 'Сложный' };
  const DIFFICULTY_COLOR: Record<string, string> = {
    easy: 'bg-emerald-100 text-emerald-700',
    medium: 'bg-amber-100 text-amber-700',
    hard: 'bg-red-100 text-red-700',
  };

  return (
    <motion.div
      className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4"
      initial="hidden"
      animate="visible"
      custom={6}
      variants={fadeUp}
    >
      <h3 className="text-sm font-semibold text-gray-700">📚 Рекомендуемые кейсы для прокачки</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {recommended.map((c) => (
          <Link
            key={c.id}
            href={`/?caseId=${c.id}`}
            className="block rounded-xl border border-gray-100 p-3 hover:border-indigo-300 hover:shadow-sm transition-all space-y-1"
          >
            <div className="flex items-center gap-2">
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${DIFFICULTY_COLOR[c.difficulty]}`}>
                {DIFFICULTY_LABELS[c.difficulty]}
              </span>
            </div>
            <p className="text-sm font-medium text-gray-800">{c.title}</p>
          </Link>
        ))}
      </div>
    </motion.div>
  );
}
