'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { motion, AnimatePresence, type Variants } from 'framer-motion';
import { cases, guidedStarterCase, getRandomCase } from './lib/cases';
import { useAuth } from './lib/auth-context';
import { saveAttempt, loadAttempts, calcStats } from './lib/firestore-progress';
import { BadgeMeta, buildGamification, getBadgeMeta } from './lib/gamification';
import {
  AppScreen,
  Case,
  SelfReview,
  FeedbackResponse,
  RubricScores,
  UpgradeResponse,
  SolutionSections,
} from './lib/types';
import { track } from './lib/analytics';

// ─── constants ───────────────────────────────────────────────────────────────

const RUBRIC_LABELS: Record<keyof RubricScores, string> = {
  problemFraming: 'Формулировка проблемы',
  diagnosis: 'Диагностика',
  metricsThinking: 'Метрики',
  prioritization: 'Приоритизация',
  tradeOffs: 'Компромиссы и риски',
  clarityStructure: 'Структура и ясность',
};

const RUBRIC_DESCRIPTIONS: Record<keyof RubricScores, string> = {
  problemFraming: 'Чётко определяете суть проблемы, её границы и контекст',
  diagnosis: 'Гипотезы о причинах, проверяете их логично и последовательно',
  metricsThinking: 'Правильные метрики — north star, guardrails, ведущие показатели',
  prioritization: 'Обосновываете приоритет действий: impact / effort / risk',
  clarityStructure: 'Структурированный и понятный ответ без воды и повторений',
  tradeOffs: 'Называете риски, ограничения и компромиссы решений',
};

// ─── helpers ──────────────────────────────────────────────────────────────────

function pluralRu(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(n);
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
}

// Maps camelCase / UPPERCASE dimension keys from AI to Russian labels
const DIMENSION_LABELS: Record<string, string> = {
  problemframing:   'Формулировка проблемы',
  diagnosis:        'Диагностика',
  metricsthinking:  'Метрики',
  prioritization:   'Приоритизация',
  claritystructure: 'Структура и ясность',
  tradeoffs:        'Компромиссы и риски',
};

function formatDimension(raw: string): string {
  const key = raw.toLowerCase().replace(/[\s_-]/g, '');
  if (DIMENSION_LABELS[key]) return DIMENSION_LABELS[key];
  // fallback: split camelCase → "Camel Case"
  return raw
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, s => s.toUpperCase())
    .trim();
}

// ─── progress tracking (Firestore) ──────────────────────────────────────────

const DIFFICULTY_LABELS: Record<string, string> = {
  easy: 'Лёгкий',
  medium: 'Средний',
  hard: 'Сложный',
};

const DIFFICULTY_COLOR: Record<string, string> = {
  easy: 'bg-emerald-100 text-emerald-700',
  medium: 'bg-amber-100 text-amber-700',
  hard: 'bg-red-100 text-red-700',
};

const DIFFICULTY_BORDER: Record<string, string> = {
  easy: 'border-emerald-200 hover:border-emerald-400',
  medium: 'border-amber-200 hover:border-amber-400',
  hard: 'border-red-200 hover:border-red-400',
};

const SOLUTION_STEPS: { key: keyof SolutionSections; label: string; placeholder: string; hint: string }[] = [
  { key: 'framing',     label: 'Формулировка проблемы',       placeholder: 'Что именно не так? Границы проблемы? Почему важно сейчас?',              hint: 'Критерий 1: формулировка' },
  { key: 'hypotheses',  label: 'Гипотезы о причинах',         placeholder: 'Возможные причины, что наиболее вероятно, что проверить первым?',        hint: 'Критерий 2: диагностика' },
  { key: 'metrics',     label: 'Метрики для проверки',        placeholder: 'Конкретные метрики — north star, leading indicators, guardrails',         hint: 'Критерий 3: метрики' },
  { key: 'actions',     label: 'Приоритизированные действия', placeholder: 'Что делать, в каком порядке и почему именно так?',                      hint: 'Критерий 4: приоритизация' },
  { key: 'risks',       label: 'Риски и компромиссы',         placeholder: 'Что может пойти не так? Какие trade-offs в вашем решении?',              hint: 'Критерии 5–6: риски, структура' },
];

const EMPTY_SOLUTION: SolutionSections = { framing: '', hypotheses: '', metrics: '', actions: '', risks: '' };

function joinSolution(s: SolutionSections): string {
  return [
    s.framing    && `## Формулировка проблемы\n${s.framing}`,
    s.hypotheses && `## Гипотезы\n${s.hypotheses}`,
    s.metrics    && `## Метрики\n${s.metrics}`,
    s.actions    && `## Действия\n${s.actions}`,
    s.risks      && `## Риски\n${s.risks}`,
  ].filter(Boolean).join('\n\n');
}

// Для апгрейда — всегда включаем все 5 секций, пустые помечаем
function joinSolutionFull(s: SolutionSections): string {
  return [
    `## Формулировка проблемы\n${s.framing || '[не заполнено студентом]'}`,
    `## Гипотезы\n${s.hypotheses || '[не заполнено студентом]'}`,
    `## Метрики\n${s.metrics || '[не заполнено студентом]'}`,
    `## Действия\n${s.actions || '[не заполнено студентом]'}`,
    `## Риски\n${s.risks || '[не заполнено студентом]'}`,
  ].join('\n\n');
}

const STEPS = ['Кейс', 'Ответ', 'Самооценка', 'Фидбек'];
const STEP_FOR_SCREEN: Record<AppScreen, number> = {
  landing: -1,
  'case-browser': -1,
  case: 1,
  'self-review': 2,
  feedback: 3,
  upgrade: 3,
};

// ─── shared ui ───────────────────────────────────────────────────────────────

function ScoreBar({ score }: { score: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className={`w-5 h-5 rounded-sm transition-colors ${
              i <= score
                ? score <= 2
                  ? 'bg-red-400'
                  : score <= 3
                  ? 'bg-amber-400'
                  : 'bg-emerald-400'
                : 'bg-gray-200'
            }`}
          />
        ))}
      </div>
      <span className="text-sm text-gray-500 w-8">{score}/5</span>
    </div>
  );
}

function Stepper({ screen }: { screen: AppScreen }) {
  const current = STEP_FOR_SCREEN[screen];
  if (current < 0) return null;
  return (
    <div className="max-w-sm mx-auto mb-6">
      {/* Ряд 1: кружки + линии — выровнены по центру кружка */}
      <div className="flex items-center justify-center">
        {STEPS.map((label, i) => {
          const done = i < current;
          const active = i === current;
          return (
            <div key={label} className="flex items-center">
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
                  done
                    ? 'bg-indigo-600 text-white'
                    : active
                    ? 'bg-indigo-100 text-indigo-700 ring-2 ring-indigo-500'
                    : 'bg-gray-100 text-gray-400'
                }`}
              >
                {done ? '✓' : i + 1}
              </div>
              {i < STEPS.length - 1 && (
                <div className={`w-10 h-0.5 mx-1 ${i < current ? 'bg-indigo-600' : 'bg-gray-200'}`} />
              )}
            </div>
          );
        })}
      </div>
      {/* Ряд 2: подписи — точно под кружками */}
      <div className="flex items-start justify-center mt-1">
        {STEPS.map((label, i) => {
          const active = i === current;
          return (
            <div key={label} className="flex items-center">
              <span className={`text-[10px] w-7 text-center block ${active ? 'text-indigo-700 font-semibold' : 'text-gray-400'}`}>
                {label}
              </span>
              {i < STEPS.length - 1 && <div className="w-10 mx-1" />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// renders markdown-ish text (bold **x**, headers ##, bullets -)
function applyInlineMarkdown(html: string): string {
  return html
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')  // **bold**
    .replace(/\*([^*\n]+?)\*/g, '<strong>$1</strong>')  // *bold* single asterisk
    .replace(/\*/g, '');                                 // strip leftover asterisks
}

function preprocessText(text: string): string {
  // Split inline numbered items "1. foo 2. bar" onto separate lines
  return text
    .split('\n')
    .flatMap(line => {
      // If line has inline "number. " patterns mid-sentence, split them
      const parts = line.split(/(?<=\S)\s+(?=\d+\.\s)/);
      return parts.length > 1 ? parts : [line];
    })
    .join('\n');
}

function SimpleMarkdown({ text }: { text: string }) {
  const lines = preprocessText(text).split('\n');
  const output: React.ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // Table: collect consecutive lines starting with |
    if (line.trimStart().startsWith('|')) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trimStart().startsWith('|')) {
        tableLines.push(lines[i]);
        i++;
      }
      const rows = tableLines
        .filter(l => !/^\s*\|[-:\s|]+\|\s*$/.test(l)) // remove separator rows
        .map(l =>
          l.split('|')
            .map(c => c.trim())
            .filter((_, idx, arr) => idx > 0 && idx < arr.length - 1)
        );
      if (rows.length > 0) {
        output.push(
          <div key={i} className="overflow-x-auto my-2">
            <table className="text-xs w-full border-collapse">
              <thead>
                <tr>
                  {rows[0].map((cell, ci) => (
                    <th key={ci} className="border border-gray-300 bg-gray-100 px-2 py-1 text-left font-semibold text-gray-700"
                      dangerouslySetInnerHTML={{ __html: applyInlineMarkdown(cell) }} />
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(1).map((row, ri) => (
                  <tr key={ri}>
                    {row.map((cell, ci) => (
                      <td key={ci} className="border border-gray-200 px-2 py-1 text-gray-700"
                        dangerouslySetInnerHTML={{ __html: applyInlineMarkdown(cell) }} />
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }
      continue;
    }
    if (line.startsWith('## ')) {
      output.push(
        <p key={i} className="font-semibold text-gray-800 mt-3 mb-1 text-sm">
          {line.replace('## ', '')}
        </p>
      );
    } else if (line.startsWith('**') && line.endsWith('**')) {
      output.push(
        <p key={i} className="font-semibold text-gray-700 text-sm">
          {line.replace(/\*\*/g, '')}
        </p>
      );
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      output.push(
        <p key={i} className="text-sm text-gray-700 pl-3 flex gap-2">
          <span className="text-gray-400 flex-shrink-0">•</span>
          <span dangerouslySetInnerHTML={{ __html: applyInlineMarkdown(line.slice(2)) }} />
        </p>
      );
    } else if (/^\d+\.\s/.test(line)) {
      const match = line.match(/^(\d+)\.\s(.*)$/);
      if (match) {
        output.push(
          <p key={i} className="text-sm text-gray-700 pl-3 flex gap-2">
            <span className="text-gray-500 flex-shrink-0 font-medium">{match[1]}.</span>
            <span dangerouslySetInnerHTML={{ __html: applyInlineMarkdown(match[2]) }} />
          </p>
        );
      }
    } else if (line.trim() === '') {
      output.push(<div key={i} className="h-1" />);
    } else {
      output.push(
        <p
          key={i}
          className="text-sm text-gray-700"
          dangerouslySetInnerHTML={{ __html: applyInlineMarkdown(line) }}
        />
      );
    }
    i++;
  }
  return <div className="space-y-1">{output}</div>;
}

// ─── landing ─────────────────────────────────────────────────────────────────

function LandingScreen({
  onGuided,
  onBrowse,
  progressStats,
  onResetProgress,
  isLoggedIn,
  nextCaseTitle,
  allCasesSolved,
}: {
  onGuided: () => void;
  onBrowse: () => void;
  progressStats: { total: number; avgScore: number; uniqueCases: number } | null;
  onResetProgress: () => void;
  isLoggedIn: boolean;
  nextCaseTitle?: string;
  allCasesSolved?: boolean;
}) {
  const [confirmReset, setConfirmReset] = useState(false);
  const fadeUp: Variants = {
    hidden: { opacity: 0, y: 20 },
    visible: (i: number) => ({ opacity: 1, y: 0, transition: { delay: i * 0.1, duration: 0.4, ease: 'easeOut' as const } }),
  };
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-16 bg-gradient-to-br from-slate-50 to-indigo-50">
      <div className="max-w-xl w-full text-center space-y-8">
        <motion.div className="space-y-3" initial="hidden" animate="visible" custom={0} variants={fadeUp}>
          <span className="inline-block bg-indigo-100 text-indigo-700 text-xs font-semibold px-3 py-1 rounded-full uppercase tracking-wide">
            AI-тренажёр для продуктовых интервью
          </span>
          <h1 className="text-4xl font-bold text-gray-900 leading-tight">
            CaseTrainer
          </h1>
          <p className="text-lg text-gray-600 leading-relaxed">
            Реши продуктовый кейс прямо сейчас — получи AI-разбор по 6 критериям.<br />
            <span className="text-indigo-600 font-medium">Без регистрации.</span>
          </p>
        </motion.div>

        {/* How it works */}
        <motion.div className="grid grid-cols-3 gap-3 text-center" initial="hidden" animate="visible" custom={1} variants={fadeUp}>
          {[
            { icon: '📋', step: '1', label: 'Получаешь кейс', sub: 'Реальная продуктовая задача' },
            { icon: '✍️', step: '2', label: 'Пишешь решение', sub: 'В свободной форме' },
            { icon: '🤖', step: '3', label: 'AI разбирает', sub: 'Оценка по 6 критериям + что улучшить' },
          ].map((item) => (
            <div key={item.step} className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 relative">
              <div className="absolute -top-2 -left-2 bg-indigo-600 text-white text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center">{item.step}</div>
              <div className="text-2xl mb-1">{item.icon}</div>
              <div className="font-semibold text-gray-800 text-sm">{item.label}</div>
              <div className="text-xs text-gray-500 mt-0.5">{item.sub}</div>
            </div>
          ))}
        </motion.div>

        {/* Preview card — sample feedback */}
        <motion.div
          className="bg-white rounded-2xl border border-indigo-100 shadow-sm p-5 text-left space-y-3"
          initial="hidden" animate="visible" custom={2} variants={fadeUp}
        >
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Пример AI-разбора</p>
            <span className="text-xs bg-emerald-100 text-emerald-700 font-bold px-2 py-0.5 rounded-full">3.8 / 5</span>
          </div>
          <div className="space-y-2">
            {[
              { label: 'Формулировка проблемы', score: 4 },
              { label: 'Метрики', score: 3 },
              { label: 'Приоритизация', score: 4 },
            ].map((item, idx) => (
              <div key={item.label} className="flex items-center gap-3">
                <span className="text-xs text-gray-600 w-44 flex-shrink-0">{item.label}</span>
                <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <motion.div
                    className={`h-full rounded-full ${item.score >= 4 ? 'bg-emerald-500' : 'bg-amber-400'}`}
                    initial={{ width: 0 }}
                    animate={{ width: `${(item.score / 5) * 100}%` }}
                    transition={{ duration: 0.7, ease: 'easeOut' as const, delay: 0.6 + idx * 0.1 }}
                  />
                </div>
                <span className="text-xs font-semibold text-gray-700 w-6 text-right">{item.score}</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-500 bg-amber-50 rounded-lg px-3 py-2 border border-amber-100">
            💡 <strong>Главное улучшение:</strong> Добавь guardrail-метрики рядом с north star — это покажет системное мышление
          </p>
        </motion.div>

        <motion.div className="space-y-3" initial="hidden" animate="visible" custom={3} variants={fadeUp}>
          {allCasesSolved ? (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-4 py-3 text-center">
              <p className="text-sm font-semibold text-emerald-700">🏆 Ты прошёл все кейсы!</p>
              <p className="text-xs text-emerald-600 mt-0.5">Можно решать их повторно — результаты улучшатся</p>
            </div>
          ) : (
            <button
              onClick={onGuided}
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-4 rounded-xl transition-colors text-lg shadow-md"
            >
              {isLoggedIn && nextCaseTitle
                ? `Следующий кейс: ${nextCaseTitle} →`
                : isLoggedIn
                ? 'Продолжить подготовку →'
                : 'Попробовать бесплатно →'}
            </button>
          )}
          <button
            onClick={onBrowse}
            className="w-full bg-white hover:bg-gray-50 text-gray-700 font-medium py-3 rounded-xl transition-colors border border-gray-200 shadow-sm"
          >
            Выбрать кейс из каталога
          </button>
          {!isLoggedIn && <p className="text-xs text-gray-400">Без карты · Без регистрации · 1 минута</p>}
        </motion.div>

        {progressStats && (
          <motion.div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 space-y-3" initial="hidden" animate="visible" custom={4} variants={fadeUp}>
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">📊 Ваш прогресс</p>
              {!confirmReset ? (
                <button
                  onClick={() => setConfirmReset(true)}
                  className="text-xs text-gray-300 hover:text-red-400 transition-colors"
                >
                  Сбросить
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">Точно сбросить?</span>
                  <button
                    onClick={() => { onResetProgress(); setConfirmReset(false); }}
                    className="text-xs font-semibold text-red-500 hover:text-red-700 transition-colors"
                  >
                    Да
                  </button>
                  <button
                    onClick={() => setConfirmReset(false)}
                    className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    Отмена
                  </button>
                </div>
              )}
            </div>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div>
                <div className="text-xl font-bold text-gray-900">{progressStats.total}</div>
                <div className="text-xs text-gray-500">{pluralRu(progressStats.total, 'попытка', 'попытки', 'попыток')}</div>
              </div>
              <div>
                <div className="text-xl font-bold text-gray-900">{progressStats.uniqueCases}</div>
                <div className="text-xs text-gray-500">{pluralRu(progressStats.uniqueCases, 'кейс', 'кейса', 'кейсов')}</div>
              </div>
              <div>
                <div className={`text-xl font-bold ${
                  progressStats.avgScore >= 4 ? 'text-emerald-600' :
                  progressStats.avgScore >= 3 ? 'text-amber-600' : 'text-red-500'
                }`}>{progressStats.avgScore.toFixed(1)}</div>
                <div className="text-xs text-gray-500">ср. балл</div>
              </div>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}

// ─── skill label map ──────────────────────────────────────────────────────────

const SKILL_LABELS: Record<string, string> = {
  retention: 'Retention',
  diagnosis: 'Диагностика',
  metrics: 'Метрики',
  funnel: 'Воронка',
  conversion: 'Конверсия',
  'experiment-design': 'A/B дизайн',
  'causal-thinking': 'Причинность',
  'north-star-metrics': 'North Star',
  'conversion-funnel': 'Воронка',
  'supply-demand': 'Спрос/Предл.',
  prioritization: 'Приоритизация',
  'catalog-quality': 'Каталог',
  onboarding: 'Онбординг',
  monetization: 'Монетизация',
  pricing: 'Прайсинг',
  'product-strategy': 'Стратегия',
  backlog: 'Бэклог',
  experiment: 'Эксперимент',
  trust: 'Доверие',
  'go-to-market': 'GTM',
  b2b: 'B2B',
  'feature-adoption': 'Adoption',
  engagement: 'Вовлечённость',
  'growth-loops': 'Growth loops',
  virality: 'Виральность',
};

// ─── case browser ─────────────────────────────────────────────────────────────

function CaseBrowserScreen({
  onSelect,
  onBack,
}: {
  onSelect: (c: Case) => void;
  onBack: () => void;
}) {
  const [filter, setFilter] = useState<'all' | 'easy' | 'medium' | 'hard'>('all');
  const [skillFilter, setSkillFilter] = useState<string | null>(null);

  const allSkills = Array.from(new Set(cases.flatMap((c) => c.skillFocus)));

  const visible = cases.filter((c) => {
    const diffOk = filter === 'all' || c.difficulty === filter;
    const skillOk = !skillFilter || c.skillFocus.includes(skillFilter);
    return diffOk && skillOk;
  });

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-10">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="text-gray-400 hover:text-gray-600 text-sm">
            ← Назад
          </button>
          <h2 className="text-xl font-bold text-gray-900">Каталог кейсов</h2>
        </div>

        {/* difficulty filter */}
        <div className="flex gap-2 flex-wrap">
          {(['all', 'easy', 'medium', 'hard'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                filter === f
                  ? f === 'all'
                    ? 'bg-gray-800 text-white border-gray-800'
                    : f === 'easy'
                    ? 'bg-emerald-500 text-white border-emerald-500'
                    : f === 'medium'
                    ? 'bg-amber-500 text-white border-amber-500'
                    : 'bg-red-500 text-white border-red-500'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
              }`}
            >
              {f === 'all' ? 'Все' : DIFFICULTY_LABELS[f]}
            </button>
          ))}
          <span className="ml-auto text-xs text-gray-400 self-center">{visible.length} {pluralRu(visible.length, 'кейс', 'кейса', 'кейсов')}</span>
        </div>

        {/* skill filter */}
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setSkillFilter(null)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
              !skillFilter ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
            }`}
          >
            Все навыки
          </button>
          {allSkills.map((s) => (
            <button
              key={s}
              onClick={() => setSkillFilter(skillFilter === s ? null : s)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                skillFilter === s
                  ? 'bg-indigo-100 text-indigo-700 border-indigo-400'
                  : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'
              }`}
            >
              {SKILL_LABELS[s] ?? s}
            </button>
          ))}
        </div>

        {/* cards */}
        <div className="space-y-3">
          {visible.map((c) => (
            <button
              key={c.id}
              onClick={() => onSelect(c)}
              className={`w-full text-left bg-white rounded-2xl border-2 p-5 transition-all shadow-sm hover:shadow-md ${DIFFICULTY_BORDER[c.difficulty]}`}
            >
              <div className="flex flex-wrap gap-2 items-center mb-3">
                <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${DIFFICULTY_COLOR[c.difficulty]}`}>
                  {DIFFICULTY_LABELS[c.difficulty]}
                </span>
                {c.skillFocus.map((s) => (
                  <span key={s} className="text-xs bg-gray-100 text-gray-600 px-2.5 py-1 rounded-full">
                    {SKILL_LABELS[s] ?? s}
                  </span>
                ))}
                <span className="text-xs text-gray-400 ml-auto">⏱ ~{c.estimatedMinutes} мин</span>
              </div>
              <p className="font-semibold text-gray-900 text-sm">{c.title}</p>
              <p className="text-xs text-gray-500 mt-1 line-clamp-2 leading-relaxed">
                {c.description.split('\n')[0]}
              </p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── case (write answer) ──────────────────────────────────────────────────────

function CaseScreen({
  activeCase,
  solution,
  setSolution,
  onAnalyze,
  onBack,
  attemptNumber,
  screen,
}: {
  activeCase: Case;
  solution: SolutionSections;
  setSolution: (s: SolutionSections) => void;
  onAnalyze: () => void;
  onBack: () => void;
  attemptNumber: number;
  screen: AppScreen;
}) {
  const totalLength = Object.values(solution).join('').trim().length;
  const tooShort = totalLength < 20;

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-10">
      <div className="max-w-2xl mx-auto">
        <Stepper screen={screen} />

        <div className="flex items-center justify-between mb-4">
          <button onClick={onBack} className="text-gray-400 hover:text-gray-600 text-sm">
            ← Назад
          </button>
          {attemptNumber > 1 && (
            <span className="text-xs bg-indigo-100 text-indigo-700 font-semibold px-3 py-1 rounded-full">
              Попытка #{attemptNumber}
            </span>
          )}
        </div>

        <div className="space-y-5">
          {/* case card */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">
            <div className="flex flex-wrap gap-2 items-center">
              <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${DIFFICULTY_COLOR[activeCase.difficulty]}`}>
                {DIFFICULTY_LABELS[activeCase.difficulty]}
              </span>
              {activeCase.skillFocus.map((skill) => (
                <span key={skill} className="text-xs bg-gray-100 text-gray-600 px-2.5 py-1 rounded-full">
                  {SKILL_LABELS[skill] ?? skill}
                </span>
              ))}
              <span className="text-xs text-gray-400 ml-auto">⏱ ~{activeCase.estimatedMinutes} мин</span>
            </div>
            <h2 className="text-xl font-bold text-gray-900">{activeCase.title}</h2>
            <p className="text-gray-700 whitespace-pre-wrap leading-relaxed text-sm">
              {activeCase.description}
            </p>
            <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-3 text-sm text-indigo-800">
              <span className="font-semibold">Фокус кейса: </span>
              {activeCase.expectedFocus}
            </div>
          </div>

          {/* rubric preview */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-800">📋 Критерии оценки</h3>
              <span className="text-xs bg-indigo-50 text-indigo-600 font-medium px-2.5 py-1 rounded-full">6 критериев, каждый 1–5</span>
            </div>
            <div className="space-y-3">
              {(Object.entries(RUBRIC_LABELS) as [keyof RubricScores, string][]).map(([key, label], i) => (
                <div key={key} className="flex gap-3 items-start">
                  <span className="w-5 h-5 rounded-full bg-gray-100 text-gray-500 flex items-center justify-center flex-shrink-0 text-xs font-bold mt-0.5">
                    {i + 1}
                  </span>
                  <div>
                    <span className="text-sm font-medium text-gray-800">{label}</span>
                    <span className="text-xs text-gray-400 ml-2">— {RUBRIC_DESCRIPTIONS[key]}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* answer — 5 steps */}
          <div className="space-y-3">
            <div className="flex items-center justify-between px-1 mb-1">
              <h3 className="font-semibold text-gray-800">Ваш ответ</h3>
              <span className={`text-xs ${tooShort && totalLength > 0 ? 'text-orange-400' : 'text-gray-400'}`}>
                {totalLength === 0 ? 'Заполните хотя бы один раздел' : `${totalLength} симв. суммарно${tooShort ? ' — напишите немного больше' : ''}`}
              </span>
            </div>

            {SOLUTION_STEPS.map((step, i) => (
              <div key={step.key} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-2">
                <div className="flex items-start gap-3">
                  <span className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center flex-shrink-0 text-xs font-bold mt-0.5">
                    {i + 1}
                  </span>
                  <div>
                    <span className="text-sm font-semibold text-gray-800">{step.label}</span>
                    <span className="text-xs text-gray-400 ml-2">— {step.hint}</span>
                  </div>
                </div>
                <textarea
                  className="w-full h-24 border border-gray-200 rounded-xl p-3 text-gray-800 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-indigo-400 placeholder-gray-400"
                  placeholder={step.placeholder}
                  value={solution[step.key]}
                  onChange={(e) => setSolution({ ...solution, [step.key]: e.target.value })}
                />
              </div>
            ))}

            <button
              onClick={onAnalyze}
              disabled={totalLength === 0}
              className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold py-3 rounded-xl transition-colors"
            >
              Далее: самооценка →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── self-review ──────────────────────────────────────────────────────────────

function SelfReviewScreen({
  selfReview,
  setSelfReview,
  onAnalyze,
  loading,
  onBack,
  screen,
  isGuest,
}: {
  selfReview: SelfReview;
  setSelfReview: (sr: SelfReview) => void;
  onAnalyze: () => void;
  loading: boolean;
  onBack: () => void;
  screen: AppScreen;
  isGuest?: boolean;
}) {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-10">
      <div className="max-w-lg w-full">
        <Stepper screen={screen} />
        <button onClick={onBack} className="text-gray-400 hover:text-gray-600 text-sm mb-4 block">
          ← Назад
        </button>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-6">
          <div>
            <h2 className="text-xl font-bold text-gray-900">Самооценка</h2>
            <p className="text-sm text-gray-500 mt-1">
              Ответьте честно — это улучшит качество обратной связи
            </p>
          </div>

          <div className="space-y-3">
            <label className="block text-sm font-medium text-gray-700">
              Насколько вы уверены в своём ответе?
            </label>
            <div className="flex gap-2">
              {([1, 2, 3, 4, 5] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setSelfReview({ ...selfReview, confidence: v })}
                  className={`flex-1 py-3 rounded-xl text-sm font-semibold border-2 transition-colors ${
                    selfReview.confidence === v
                      ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                      : 'border-gray-200 text-gray-500 hover:border-gray-300'
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
            <div className="flex justify-between text-xs text-gray-400 px-1">
              <span>Не уверен</span>
              <span>Очень уверен</span>
            </div>
          </div>

          <div className="space-y-2">
            <label className="block text-sm font-medium text-gray-700">
              В какой части были наименее уверены?
            </label>
            <textarea
              className="w-full h-20 border border-gray-200 rounded-xl p-3 text-sm text-gray-800 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-400 placeholder-gray-400"
              placeholder="Например: не уверен, правильно ли выбрал метрики..."
              value={selfReview.uncertainArea}
              onChange={(e) => setSelfReview({ ...selfReview, uncertainArea: e.target.value })}
            />
          </div>

          <button
            onClick={onAnalyze}
            disabled={loading}
            className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white font-semibold py-3 rounded-xl transition-colors flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                Анализирую ваш ответ...
              </>
            ) : (
              'Анализировать →'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── feedback ─────────────────────────────────────────────────────────────────

// Skeleton pulsing card
function SkeletonBlock({ className = '' }: { className?: string }) {
  return <div className={`bg-gray-200 rounded-xl animate-pulse ${className}`} />;
}

function UpgradeLoadingScreen({ activeCase, screen }: { activeCase: Case; screen: AppScreen }) {
  return (
    <div className="min-h-screen bg-gray-50 px-4 py-10">
      <div className="max-w-2xl mx-auto space-y-5">
        <Stepper screen={screen} />
        <div className="bg-gradient-to-br from-violet-600 to-indigo-600 rounded-2xl p-6 text-white space-y-2">
          <div className="flex items-center gap-3">
            <span className="text-3xl">🤖</span>
            <div>
              <h2 className="text-xl font-bold">AI дорабатывает ваш ответ…</h2>
              <p className="text-violet-200 text-sm mt-0.5">{activeCase.title}</p>
            </div>
          </div>
          <p className="text-sm text-violet-100 leading-relaxed">
            Это займёт 20–40 секунд. AI разберёт каждый раздел и покажет конкретные улучшения.
          </p>
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">
          <SkeletonBlock className="h-5 w-32" />
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-gray-50 rounded-xl p-4 space-y-3">
              <div className="flex items-center gap-2">
                <SkeletonBlock className="h-5 w-5 rounded-full" />
                <SkeletonBlock className="h-4 w-36" />
              </div>
              <SkeletonBlock className="h-10 w-full" />
              <SkeletonBlock className="h-10 w-full" />
            </div>
          ))}
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 flex items-center gap-4">
          <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
          <p className="text-sm text-gray-600">Анализирую ваш ответ и готовлю объяснения…</p>
        </div>
      </div>
    </div>
  );
}

function FeedbackSkeletonScreen({ screen }: { screen: AppScreen }) {
  return (
    <div className="min-h-screen bg-gray-50 px-4 py-10">
      <div className="max-w-2xl mx-auto space-y-5">
        <Stepper screen={screen} />
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">
          <SkeletonBlock className="h-7 w-48" />
          <SkeletonBlock className="h-5 w-64" />
          <div className="bg-gray-50 rounded-xl p-4 flex items-center gap-5">
            <SkeletonBlock className="h-14 w-14 rounded-2xl" />
            <div className="space-y-2 flex-1">
              <SkeletonBlock className="h-5 w-32" />
              <SkeletonBlock className="h-4 w-48" />
            </div>
          </div>
        </div>
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">
          <SkeletonBlock className="h-5 w-32" />
          {[1,2,3,4,5,6].map((i) => (
            <div key={i} className="flex items-center justify-between gap-4">
              <SkeletonBlock className="h-4 w-40" />
              <SkeletonBlock className="h-3 flex-1 max-w-[180px]" />
            </div>
          ))}
        </div>
        <div className="bg-emerald-50 rounded-2xl p-5 space-y-3">
          <SkeletonBlock className="h-5 w-36" />
          <SkeletonBlock className="h-4 w-full" />
          <SkeletonBlock className="h-4 w-5/6" />
        </div>
        <div className="bg-amber-50 rounded-2xl p-5 space-y-3">
          <SkeletonBlock className="h-5 w-36" />
          <SkeletonBlock className="h-4 w-full" />
          <SkeletonBlock className="h-4 w-4/5" />
          <SkeletonBlock className="h-4 w-3/4" />
        </div>
      </div>
    </div>
  );
}

// Animated rubric bar — fills from 0 to (score/5)*100% on mount
function AnimatedRubricBar({ score, delay = 0 }: { score: number; delay?: number }) {
  const pct = (score / 5) * 100;
  const color = score >= 4 ? 'bg-emerald-500' : score >= 3 ? 'bg-amber-500' : 'bg-rose-500';
  return (
    <div className="flex items-center gap-2 flex-1">
      <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden max-w-[180px]">
        <motion.div
          className={`h-full rounded-full ${color}`}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.6, ease: 'easeOut' as const, delay }}
        />
      </div>
      <span className="text-sm font-semibold text-gray-900 w-8 text-right">{score}/5</span>
    </div>
  );
}

// Count-up animated score number
function AnimatedScore({ value }: { value: number }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    let start = 0;
    const end = value;
    const duration = 800;
    const steps = 30;
    const increment = end / steps;
    const intervalMs = duration / steps;
    const timer = setInterval(() => {
      start += increment;
      if (start >= end) { setDisplay(end); clearInterval(timer); }
      else setDisplay(parseFloat(start.toFixed(1)));
    }, intervalMs);
    return () => clearInterval(timer);
  }, [value]);
  return <>{display.toFixed(1)}</>;
}

function FeedbackScreen({
  feedback,
  activeCase,
  attemptNumber,
  selfReview,
  previousFeedback,
  onRetry,
  onNextCase,
  onUpgrade,
  onHome,
  upgradeLoading,
  feedbackUseful,
  onFeedbackUseful,
  newBadges,
  screen,
  isGuest,
  guestUpgradeUsed,
}: {
  feedback: FeedbackResponse;
  activeCase: Case;
  attemptNumber: number;
  selfReview: SelfReview;
  previousFeedback: FeedbackResponse | null;
  onRetry: () => void;
  onNextCase: () => void;
  onUpgrade: () => void;
  onHome: () => void;
  upgradeLoading: boolean;
  feedbackUseful: boolean | null;
  onFeedbackUseful: (v: boolean) => void;
  newBadges: BadgeMeta[];
  screen: AppScreen;
  isGuest: boolean;
  guestUpgradeUsed: boolean;
}) {
  const avgScore =
    Object.values(feedback.scores).reduce((a, b) => a + b, 0) /
    Object.values(feedback.scores).length;

  const scoreLabel =
    avgScore >= 4
      ? { text: 'Сильный ответ', color: 'text-emerald-600' }
      : avgScore >= 3
      ? { text: 'Средний уровень', color: 'text-amber-600' }
      : { text: 'Есть над чем работать', color: 'text-red-500' };

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-10">
      <div className="max-w-2xl mx-auto space-y-5">
        <Stepper screen={screen} />

        {/* Demo banner */}
        {feedback.isMock && (
          <div className="bg-amber-50 border border-amber-300 rounded-2xl p-5 space-y-2">
            <div className="flex items-center gap-2 font-semibold text-amber-800">
              <span>⚠️</span>
              <span>Демо-режим — API ключ не настроен</span>
            </div>
            <p className="text-sm text-amber-700">
              Реальная оценка недоступна. Оценки ниже не отражают качество вашего ответа.
            </p>
            <p className="text-xs text-amber-600">
              Нажмите <strong>⚙</strong> в правом нижнем углу, введите ваш{' '}
              <a href="https://openrouter.ai/settings/keys" target="_blank" rel="noreferrer" className="underline">OpenRouter API ключ</a>{' '}
              и нажмите Сохранить.
            </p>
          </div>
        )}

        {newBadges.length > 0 && (
          <div className="bg-indigo-50 border border-indigo-200 rounded-2xl p-5 space-y-3">
            <h3 className="font-semibold text-indigo-800">🎉 Вы получили бейдж!</h3>
            <div className="grid sm:grid-cols-2 gap-2">
              {newBadges.map((badge) => (
                <div key={badge.id} className="bg-white border border-indigo-100 rounded-xl px-3 py-2">
                  <p className="text-sm font-semibold text-gray-800">
                    {badge.icon} {badge.title}
                  </p>
                  <p className="text-xs text-gray-500 mt-0.5">{badge.description}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* header + score */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="text-xl font-bold text-gray-900">Обратная связь</h2>
              <p className="text-sm text-gray-500 mt-0.5">{activeCase.title}</p>
            </div>
            {attemptNumber > 1 && (
              <span className="text-xs bg-indigo-100 text-indigo-700 font-semibold px-2.5 py-1 rounded-full">
                Попытка #{attemptNumber}
              </span>
            )}
          </div>

          {!feedback.isMock && (
            <motion.div
              className="flex items-center gap-5 bg-gray-50 rounded-xl p-4"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.4, delay: 0.1 }}
            >
              <div className="text-5xl font-bold text-gray-900">
                <AnimatedScore value={avgScore} />
              </div>
              <div>
                <div className={`font-semibold text-base ${scoreLabel.color}`}>{scoreLabel.text}</div>
                <div className="text-xs text-gray-500 mt-0.5">средний балл из 5.0 по 6 критериям</div>
              </div>
            </motion.div>
          )}
        </div>

        {/* confidence calibration */}
        {!feedback.isMock && (() => {
          const gap = selfReview.confidence - avgScore;
          const absGap = Math.abs(gap);
          const cal =
            absGap <= 0.8
              ? { label: '🎯 Хорошая калибровка', desc: 'Самооценка близка к реальному уровню', textColor: 'text-emerald-700', bgColor: 'bg-emerald-50 border-emerald-100' }
              : gap > 0
              ? { label: '📈 Переоценка', desc: 'Вы оценивали себя выше, чем показал анализ', textColor: 'text-amber-700', bgColor: 'bg-amber-50 border-amber-100' }
              : { label: '📉 Недооценка', desc: 'Вы оценивали себя ниже результата — синдром самозванца?', textColor: 'text-indigo-700', bgColor: 'bg-indigo-50 border-indigo-100' };
          return (
            <div className={`rounded-2xl border p-5 space-y-3 ${cal.bgColor}`}>
              <div className="flex items-center justify-between">
                <h3 className={`font-semibold ${cal.textColor}`}>🔮 Калибровка самооценки</h3>
                <span className={`text-xs font-semibold ${cal.textColor} opacity-80`}>{cal.label}</span>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-center flex-1 bg-white bg-opacity-60 rounded-xl py-3">
                  <div className="text-2xl font-bold text-gray-900">{selfReview.confidence}/5</div>
                  <div className="text-xs text-gray-500 mt-0.5">ваша самооценка</div>
                </div>
                <div className="text-2xl text-gray-400">⟶</div>
                <div className="text-center flex-1 bg-white bg-opacity-60 rounded-xl py-3">
                  <div className="text-2xl font-bold text-gray-900">{avgScore.toFixed(1)}/5</div>
                  <div className="text-xs text-gray-500 mt-0.5">оценка AI</div>
                </div>
                <div className={`text-sm font-bold w-14 text-right ${cal.textColor}`}>
                  {gap > 0 ? `+${gap.toFixed(1)}` : gap.toFixed(1)}
                </div>
              </div>
              <p className={`text-xs ${cal.textColor}`}>{cal.desc}</p>
            </div>
          );
        })()}

        {/* version comparison */}
        {!feedback.isMock && attemptNumber > 1 && previousFeedback && (() => {
          const prevAvg = Object.values(previousFeedback.scores).reduce((a, b) => a + b, 0) / 6;
          const totalDelta = avgScore - prevAvg;
          return (
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold text-gray-800">📈 Прогресс: попытка #{attemptNumber - 1} → #{attemptNumber}</h3>
                <span className={`text-sm font-bold ${
                  totalDelta > 0 ? 'text-emerald-600' : totalDelta < 0 ? 'text-red-500' : 'text-gray-400'
                }`}>
                  {totalDelta > 0 ? '+' : ''}{totalDelta.toFixed(1)} средний
                </span>
              </div>
              <div className="space-y-2">
                {(Object.entries(feedback.scores) as [keyof RubricScores, number][]).map(([key, score]) => {
                  const prev = previousFeedback.scores[key];
                  const delta = score - prev;
                  return (
                    <div key={key} className="flex items-center text-sm">
                      <span className="text-gray-600 flex-1">{RUBRIC_LABELS[key]}</span>
                      <span className="text-gray-400 text-xs mr-1">{prev}/5</span>
                      <span className="text-gray-400 mx-1">→</span>
                      <span className="font-semibold text-gray-900 w-8">{score}/5</span>
                      <span className={`text-xs font-bold w-8 text-right ${
                        delta > 0 ? 'text-emerald-600' : delta < 0 ? 'text-red-500' : 'text-gray-300'
                      }`}>
                        {delta > 0 ? `+${delta}` : delta === 0 ? '—' : delta}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* rubric — always shown, greyed in mock */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-gray-800">Оценка по рубрике</h3>
            {feedback.isMock && <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">доступно после подключения AI</span>}
          </div>
          <div className="space-y-3">
            {(Object.entries(feedback.scores) as [keyof RubricScores, number][]).map(([key, score], idx) => (
              <div key={key} className="flex items-center justify-between">
                <span className="text-sm text-gray-700 w-48">{RUBRIC_LABELS[key]}</span>
                {feedback.isMock
                  ? <div className="flex gap-1">{[1,2,3,4,5].map(i => <div key={i} className="w-5 h-5 rounded-sm bg-gray-200" />)}</div>
                  : <AnimatedRubricBar score={score} delay={idx * 0.07} />}
              </div>
            ))}
          </div>
          {!feedback.isMock && <p className="text-xs text-gray-400 border-t pt-3">{feedback.disclaimer}</p>}
        </div>

        {/* strengths */}
        {feedback.strengths.length > 0 && (
          <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-5 space-y-3">
            <h3 className="font-semibold text-emerald-800">✓ Сильные стороны</h3>
            <ul className="space-y-1.5">
              {feedback.strengths.map((s, i) => (
                <li key={i} className="text-sm text-emerald-700 flex gap-2">
                  <span className="mt-0.5 flex-shrink-0">•</span>
                  <span>{s}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* issues */}
        {feedback.issues.length > 0 && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-4">
            <h3 className="font-semibold text-gray-800">⚠ Что можно улучшить</h3>
            <div className="space-y-3">
              {feedback.issues.map((issue, i) => (
                <div key={i} className="border-l-4 border-amber-400 bg-amber-50 rounded-r-xl p-4 space-y-1">
                  <div className="text-xs font-semibold text-amber-700 tracking-wide">
                    {formatDimension(issue.dimension)}
                  </div>
                  <p className="text-sm text-gray-800">{issue.issue}</p>
                  <p className="text-xs text-gray-500">
                    <span className="font-medium">Почему важно: </span>
                    {issue.whyItMatters}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* top fixes — only real feedback */}
        {!feedback.isMock && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 space-y-3">
            <h3 className="font-semibold text-gray-800">🎯 Топ-3 улучшения для следующей попытки</h3>
            <ol className="space-y-2">
              {feedback.topFixes.map((fix, i) => (
                <li key={i} className="flex gap-3 text-sm text-gray-700">
                  <span className="w-5 h-5 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center flex-shrink-0 text-xs font-bold mt-0.5">
                    {i + 1}
                  </span>
                  <span>{fix}</span>
                </li>
              ))}
            </ol>
          </div>
        )}

        {/* next iteration prompt — only real feedback */}
        {!feedback.isMock && (
          <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-5 space-y-2">
            <h3 className="font-semibold text-indigo-800">📝 Задание для следующей попытки</h3>
            <p className="text-sm text-indigo-700">{feedback.nextIterationPrompt}</p>
          </div>
        )}

        {/* mock empty-state */}
        {feedback.isMock && (
          <div className="bg-white rounded-2xl border border-dashed border-gray-300 p-6 space-y-5">
            <div className="text-center space-y-2">
              <div className="text-4xl">🔑</div>
              <h3 className="font-semibold text-gray-800">Подключите AI для получения фидбека</h3>
              <p className="text-sm text-gray-500 max-w-sm mx-auto">
                После подключения ключа вы увидите здесь: оценку по 6 критериям, сильные стороны, 
                конкретные замечания и задание для следующей итерации.
              </p>
            </div>
            <div className="bg-gray-50 rounded-xl p-4 space-y-3">
              <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Как подключить</p>
              <ol className="space-y-2">
                {[
                  <>Получите ключ на <a href="https://openrouter.ai/settings/keys" target="_blank" rel="noreferrer" className="text-indigo-600 underline">openrouter.ai/settings/keys</a></>,
                  <>Нажмите кнопку <strong>⚙</strong> в правом нижнем углу экрана</>,
                  <>Вставьте ключ и выберите модель</>,
                  <>Нажмите <strong>Сохранить</strong> и повторите попытку</>,
                ].map((step, i) => (
                  <li key={i} className="flex gap-3 text-sm text-gray-700">
                    <span className="w-5 h-5 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center flex-shrink-0 text-xs font-bold mt-0.5">
                      {i + 1}
                    </span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        )}

        {/* example solution — always shown */}
        {activeCase.exampleSolution && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="bg-gray-50 border-b border-gray-100 px-5 py-3 flex items-center justify-between">
              <h3 className="font-semibold text-gray-800">📚 Пример сильного ответа</h3>
              <span className="text-xs text-gray-400">один из возможных подходов</span>
            </div>
            <div className="p-5">
              <SimpleMarkdown text={activeCase.exampleSolution} />
            </div>
          </div>
        )}

        {/* ── AI upgrade CTA (secondary) ── */}
        {!feedback.isMock && (
          <div className="flex items-center justify-center gap-2 py-1">
            {isGuest && guestUpgradeUsed ? (
              <Link
                href="/register"
                className="text-sm text-indigo-600 hover:text-indigo-800 font-medium underline decoration-dotted flex items-center gap-1"
              >
                ✨ Зарегистрируйся, чтобы улучшить этот ответ
              </Link>
            ) : (
              <button
                onClick={onUpgrade}
                disabled={upgradeLoading}
                className="text-sm text-violet-600 hover:text-violet-800 font-medium underline decoration-dotted disabled:opacity-50 flex items-center gap-1"
              >
                {upgradeLoading ? '✨ AI дорабатывает...' : '✨ Улучшить мой ответ с помощью AI'}
              </button>
            )}
          </div>
        )}

        {/* feedback usefulness */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 flex items-center justify-between">
          <span className="text-sm text-gray-600">Этот фидбек был полезным?</span>
          <div className="flex gap-2">
            <button
              onClick={() => onFeedbackUseful(true)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                feedbackUseful === true
                  ? 'bg-emerald-100 text-emerald-700 border-2 border-emerald-400'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              👍 Да
            </button>
            <button
              onClick={() => onFeedbackUseful(false)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                feedbackUseful === false
                  ? 'bg-red-100 text-red-700 border-2 border-red-400'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              👎 Нет
            </button>
          </div>
        </div>

        {/* Guest CTA — shown for unauthenticated users */}
        {isGuest && (
          <div className="bg-gradient-to-br from-indigo-50 to-violet-50 border border-indigo-200 rounded-2xl p-6 text-center space-y-4">
            <div className="text-3xl">🎉</div>
            <div>
              <p className="font-bold text-gray-900 text-base">Ты получил AI-разбор своего ответа!</p>
              <p className="text-sm text-gray-600 mt-1">Зарегистрируйся бесплатно — сохраняй прогресс,<br />решай все 40 кейсов и смотри динамику роста</p>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <Link href="/register" className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3 rounded-xl text-sm text-center transition-colors">
                Создать аккаунт — бесплатно
              </Link>
              <Link href="/login" className="flex-1 bg-white hover:bg-gray-50 text-gray-700 font-medium py-3 rounded-xl text-sm text-center border border-gray-200 transition-colors">
                Войти
              </Link>
            </div>
          </div>
        )}

        {/* CTAs — hidden for guests */}
        {!isGuest && (
          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={onRetry}
              className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-4 rounded-xl transition-colors"
            >
              🔁 Попробовать снова
            </button>
            <button
              onClick={onNextCase}
              className="flex-1 bg-white hover:bg-gray-50 text-gray-700 font-medium py-4 rounded-xl transition-colors border border-gray-200"
            >
              Следующий кейс →
            </button>
          </div>
        )}
        <button
          onClick={onHome}
          className="w-full text-sm text-gray-400 hover:text-gray-600 py-2 pb-10 transition-colors"
        >
          ← На главную
        </button>
      </div>
    </div>
  );
}

// ─── upgrade screen ───────────────────────────────────────────────────────────

function UpgradeScreen({
  upgrade,
  activeCase,
  originalSolution,
  onRetry,
  onNextCase,
  onHome,
  isGuest,
}: {
  upgrade: UpgradeResponse;
  activeCase: Case;
  originalSolution: string;
  onRetry: () => void;
  onNextCase: () => void;
  onHome: () => void;
  isGuest: boolean;
}) {
  const [tab, setTab] = useState<'changes' | 'compare' | 'improved'>('changes');

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-10">
      <div className="max-w-2xl mx-auto space-y-5">

        {/* header */}
        <div className="bg-gradient-to-br from-violet-600 to-indigo-600 rounded-2xl p-6 text-white space-y-2">
          <div className="flex items-center gap-3">
            <span className="text-3xl">🤖</span>
            <div>
              <h2 className="text-xl font-bold">AI-наставник доработал ваш ответ</h2>
              <p className="text-violet-200 text-sm mt-0.5">{activeCase.title}</p>
            </div>
          </div>
          <p className="text-sm text-violet-100 leading-relaxed">
            Ниже — ваш ответ, улучшенный до уровня сильного кандидата. Разберите каждое изменение,
            запомните логику и попробуйте написать самостоятельно.
          </p>
        </div>

        {/* demo banner */}
        {upgrade.isMock && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-700">
            ⚠️ Демо-режим. Нажмите <strong>⚙</strong> в правом нижнем углу, добавьте{' '}
            <a href="https://openrouter.ai/settings/keys" target="_blank" rel="noreferrer" className="underline font-medium">OpenRouter API ключ</a>{' '}
            для персонализированного улучшения вашего ответа.
          </div>
        )}

        {/* tabs */}
        <div className="flex gap-1.5 bg-white rounded-xl border border-gray-100 shadow-sm p-1.5">
          {[
            { key: 'changes', label: '🔍 Разбор' },
            { key: 'compare', label: '↔ До/После' },
            { key: 'improved', label: '📄 Итог' },
          ].map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key as 'changes' | 'compare' | 'improved')}
              className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-colors ${
                tab === t.key
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* changes tab */}
        {tab === 'changes' && (
          <div className="space-y-4">
            <p className="text-sm text-gray-500 px-1">
              Каждая карточка — конкретное улучшение. Цитата из вашего ответа + как именно переписано. Полный переписанный текст — во вкладке «До/После».
            </p>

            {/* Диагностика мышления */}
            {(upgrade.weaknesses?.length || upgrade.improvementExplanation) && (
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 space-y-3">
                <h3 className="font-semibold text-amber-900 text-sm flex items-center gap-2">
                  <span>🔎</span> Диагностика мышления
                </h3>
                {upgrade.weaknesses && upgrade.weaknesses.length > 0 && (
                  <ul className="space-y-2">
                    {upgrade.weaknesses.map((w, i) => (
                      <li key={i} className="flex gap-2 text-sm text-amber-800">
                        <span className="text-amber-500 flex-shrink-0 mt-0.5">▸</span>
                        <span>{w}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {upgrade.improvementExplanation && (
                  <p className="text-sm text-amber-700 border-t border-amber-200 pt-3 leading-relaxed">
                    {upgrade.improvementExplanation}
                  </p>
                )}
              </div>
            )}

            {upgrade.changes.map((change, i) => (
              <div key={i} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                <div className="bg-gray-50 border-b border-gray-100 px-5 py-3 flex items-center gap-2">
                  <span className="w-5 h-5 rounded-full bg-violet-100 text-violet-700 flex items-center justify-center text-xs font-bold flex-shrink-0">
                    {i + 1}
                  </span>
                  <span className="font-semibold text-gray-800 text-sm">{change.section}</span>
                </div>
                <div className="p-5 space-y-4">
                  <div className="space-y-1">
                    <div className="text-xs font-semibold text-red-500 uppercase tracking-wide">Цитата из вашего ответа</div>
                    <div className="bg-red-50 border border-red-100 rounded-lg p-3 text-sm text-gray-700 italic">
                      <SimpleMarkdown text={change.original} />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-xs font-semibold text-emerald-600 uppercase tracking-wide">Как улучшено</div>
                    <div className="bg-emerald-50 border border-emerald-100 rounded-lg p-3 text-sm text-gray-700">
                      <SimpleMarkdown text={change.improved} />
                    </div>
                  </div>
                  <div className="flex gap-2 bg-indigo-50 border border-indigo-100 rounded-lg p-3">
                    <span className="text-indigo-400 flex-shrink-0 mt-0.5">💡</span>
                    <p className="text-sm text-indigo-800">{change.explanation}</p>
                  </div>
                </div>
              </div>
            ))}
            <div className="bg-gray-900 rounded-2xl p-5 space-y-3">
              <h3 className="font-semibold text-white">🧠 Ключевые уроки для запоминания</h3>
              <ol className="space-y-2">
                {(upgrade.keyLessons ?? []).filter(Boolean).map((lesson, i) => (
                  <li key={i} className="flex gap-3 text-sm text-white">
                    <span className="w-5 h-5 rounded-full bg-violet-700 text-white flex items-center justify-center flex-shrink-0 text-xs font-bold mt-0.5">
                      {i + 1}
                    </span>
                    <span>{lesson}</span>
                  </li>
                ))}
              </ol>
            </div>

            {/* Coaching Questions */}
            {upgrade.coachingQuestions && upgrade.coachingQuestions.length > 0 && (
              <div className="bg-indigo-50 border border-indigo-200 rounded-2xl p-5 space-y-3">
                <h3 className="font-semibold text-indigo-900 text-sm flex items-center gap-2">
                  <span>💬</span> Вопросы для самопроверки
                </h3>
                <p className="text-xs text-indigo-600">Попробуй ответить на каждый вопрос вслух — это и есть тренировка мышления</p>
                <ol className="space-y-2">
                  {upgrade.coachingQuestions.map((q, i) => (
                    <li key={i} className="flex gap-2 text-sm text-indigo-800">
                      <span className="font-bold flex-shrink-0 text-indigo-400">{i + 1}.</span>
                      <span>{q}</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}

            {/* Next Iteration Task */}
            {upgrade.nextIterationTask && (
              <div className="bg-emerald-50 border border-emerald-200 rounded-2xl p-5 space-y-2">
                <h3 className="font-semibold text-emerald-900 text-sm flex items-center gap-2">
                  <span>🎯</span> Задание на следующую итерацию
                </h3>
                <p className="text-sm text-emerald-800 leading-relaxed">{upgrade.nextIterationTask}</p>
              </div>
            )}
          </div>
        )}

        {/* compare tab — full before / after */}
        {tab === 'compare' && (
          <div className="space-y-4">
            <p className="text-sm text-gray-500 px-1">Ваш полный ответ сверху — улучшенная версия снизу с учётом всех комментариев ИИ.</p>

            {/* before — full original */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="px-5 py-3 bg-red-50 border-b border-red-100 flex items-center gap-2">
                <span className="text-xs font-bold text-red-500 uppercase tracking-wide">Ваш ответ</span>
              </div>
              <div className="px-5 py-4 text-sm text-gray-700 leading-relaxed">
                <SimpleMarkdown text={originalSolution} />
              </div>
            </div>

            {/* after — full upgraded */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="px-5 py-3 bg-emerald-50 border-b border-emerald-100 flex items-center gap-2">
                <span className="text-xs font-bold text-emerald-600 uppercase tracking-wide">Улучшенный ответ</span>
              </div>
              <div className="px-5 py-4 text-sm text-gray-700 leading-relaxed">
                <SimpleMarkdown text={upgrade.upgradedSolution} />
              </div>
            </div>
          </div>
        )}

        {/* improved answer tab */}
        {tab === 'improved' && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <h3 className="font-semibold text-gray-800 mb-4">Полный улучшенный ответ</h3>
            <SimpleMarkdown text={upgrade.upgradedSolution} />
          </div>
        )}

        {/* CTAs */}
        <div className="space-y-3 pb-10">
          {isGuest ? (
            <div className="bg-gradient-to-br from-indigo-50 to-violet-50 border border-indigo-200 rounded-2xl p-6 text-center space-y-4">
              <div className="text-3xl">🎉</div>
              <div>
                <p className="font-bold text-gray-900 text-base">Понравилось? Продолжай расти!</p>
                <p className="text-sm text-gray-600 mt-1">Зарегистрируйся бесплатно — решай все 40 кейсов,<br />сохраняй прогресс и смотри динамику роста</p>
              </div>
              <div className="flex flex-col sm:flex-row gap-2">
                <Link href="/register" className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3 rounded-xl text-sm text-center transition-colors">
                  Создать аккаунт — бесплатно
                </Link>
                <Link href="/login" className="flex-1 bg-white hover:bg-gray-50 text-gray-700 font-medium py-3 rounded-xl text-sm text-center border border-gray-200 transition-colors">
                  Войти
                </Link>
              </div>
            </div>
          ) : (
            <>
              <button
                onClick={onRetry}
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-4 rounded-xl transition-colors"
              >
                ✏️ Написать заново самостоятельно
              </button>
              <button
                onClick={onNextCase}
                className="w-full bg-white hover:bg-gray-50 text-gray-700 font-medium py-3 rounded-xl transition-colors border border-gray-200"
              >
                Следующий кейс →
              </button>
            </>
          )}
          <button
            onClick={onHome}
            className="w-full text-sm text-gray-400 hover:text-gray-600 py-2 transition-colors"
          >
            ← На главную
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── openrouter models ───────────────────────────────────────────────────────

const OPENROUTER_MODELS = [
  { id: 'anthropic/claude-sonnet-4.5', label: 'Claude Sonnet 4.5 (платная)' },
  { id: 'anthropic/claude-sonnet-4.6', label: 'Claude Sonnet 4.6 (платная)' },
  { id: 'anthropic/claude-opus-4.6',   label: 'Claude Opus 4.6 (платная)' },
  { id: 'openai/gpt-5.2',              label: 'GPT-5.2 (платная)' },
  { id: 'arcee-ai/trinity-large-preview:free', label: 'Arcee Trinity Large (бесплатная)' },
  { id: 'stepfun/step-3.5-flash:free', label: 'StepFun Step 3.5 Flash (бесплатная)' },
  { id: 'qwen/qwen3-235b-a22b-thinking-2507', label: 'Qwen3 235B (бесплатная)' },
];

// ─── settings modal ───────────────────────────────────────────────────────────

function SettingsModal({
  open,
  onClose,
  apiKey,
  model,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  apiKey: string;
  model: string;
  onSave: (key: string, model: string) => void;
}) {
  const [localKey, setLocalKey] = useState(apiKey);
  const [localModel, setLocalModel] = useState(model);
  const [showKey, setShowKey] = useState(false);

  // sync with parent when reopened
  useEffect(() => {
    if (open) {
      setLocalKey(apiKey);
      setLocalModel(model);
    }
  }, [open, apiKey, model]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-md mx-4">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-lg font-semibold text-gray-900">Настройки AI</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
        </div>

        <div className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              OpenRouter API Key
            </label>
            <div className="flex gap-2">
              <input
                type={showKey ? 'text' : 'password'}
                value={localKey}
                onChange={e => setLocalKey(e.target.value)}
                placeholder="sk-or-..."
                className="flex-1 text-sm border border-gray-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-400 font-mono"
              />
              <button
                type="button"
                onClick={() => setShowKey(v => !v)}
                className="px-3 py-2.5 text-xs text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50 whitespace-nowrap"
              >
                {showKey ? 'Скрыть' : 'Показать'}
              </button>
            </div>
            <p className="text-xs text-gray-400 mt-1.5">
              Получить ключ:{' '}
              <a
                href="https://openrouter.ai/settings/keys"
                target="_blank"
                rel="noopener noreferrer"
                className="text-indigo-500 hover:underline"
              >
                openrouter.ai/settings/keys
              </a>
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Модель
            </label>
            <select
              value={localModel}
              onChange={e => setLocalModel(e.target.value)}
              className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white"
            >
              {OPENROUTER_MODELS.map(m => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex gap-3 mt-6">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2.5 text-sm text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50"
          >
            Отмена
          </button>
          <button
            onClick={() => { onSave(localKey, localModel); onClose(); }}
            className="flex-1 px-4 py-2.5 text-sm font-semibold text-white bg-indigo-600 rounded-xl hover:bg-indigo-700"
          >
            Сохранить
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Onboarding modal ─────────────────────────────────────────────────────────

function OnboardingModal({ onClose }: { onClose: () => void }) {
  const steps = [
    { icon: '📝', title: '40 кейсов', desc: 'Реальные продуктовые задачи: метрики, запуск фич, монетизация, B2B' },
    { icon: '🤖', title: 'AI-обратная связь', desc: 'Получай оценку по 6 критериям и улучшенную версию своего ответа' },
    { icon: '📊', title: 'Отслеживай прогресс', desc: 'История попыток и динамика роста сохраняются в твоём профиле' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-8 space-y-6">
        <div className="text-center space-y-2">
          <div className="text-4xl">👋</div>
          <h2 className="text-2xl font-bold text-gray-900">Добро пожаловать!</h2>
          <p className="text-sm text-gray-500">
            CaseTrainer поможет прокачать структурное мышление через практику продуктовых кейсов
          </p>
        </div>

        <div className="space-y-3">
          {steps.map((s) => (
            <div key={s.title} className="flex items-start gap-4 bg-gray-50 rounded-xl p-4">
              <div className="text-2xl flex-shrink-0">{s.icon}</div>
              <div>
                <div className="font-semibold text-gray-800 text-sm">{s.title}</div>
                <div className="text-xs text-gray-500 mt-0.5">{s.desc}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="space-y-2">
          <button
            onClick={onClose}
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3 rounded-xl transition-colors text-sm shadow-md"
          >
            Начать тренировку →
          </button>
          <p className="text-center text-xs text-gray-400">
            Это сообщение больше не появится
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── main app ─────────────────────────────────────────────────────────────────

export default function Home() {
  const { user, profile, logOut } = useAuth();
  const router = useRouter();

  const [screen, setScreen] = useState<AppScreen>('landing');
  const [activeCase, setActiveCase] = useState<Case>(guidedStarterCase);
  const [solution, setSolution] = useState<SolutionSections>(EMPTY_SOLUTION);
  const [selfReview, setSelfReview] = useState<SelfReview>({ confidence: 3, uncertainArea: '' });
  const [feedback, setFeedback] = useState<FeedbackResponse | null>(null);
  const [previousFeedback, setPreviousFeedback] = useState<FeedbackResponse | null>(null);
  const [upgrade, setUpgrade] = useState<UpgradeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [upgradeLoading, setUpgradeLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attemptNumber, setAttemptNumber] = useState(1);
  const [feedbackUseful, setFeedbackUseful] = useState<boolean | null>(null);
  const [progressStats, setProgressStats] = useState<{ total: number; avgScore: number; uniqueCases: number } | null>(null);
  const [solvedCaseIds, setSolvedCaseIds] = useState<Set<number>>(new Set());
  const [newBadges, setNewBadges] = useState<BadgeMeta[]>([]);
  const [showOnboarding, setShowOnboarding] = useState(false);
  // гость может использовать апгрейд только один раз
  const [guestUpgradeUsed, setGuestUpgradeUsed] = useState(() =>
    typeof window !== 'undefined' && !!localStorage.getItem('ct_guest_upgraded')
  );

  // Онбординг — показываем один раз новым пользователям
  useEffect(() => {
    if (user && typeof window !== 'undefined') {
      const key = `ct_onboarded_${user.uid}`;
      if (!localStorage.getItem(key)) {
        setShowOnboarding(true);
      }
    }
  }, [user]);

  // reload progress stats every time user lands on the home screen + трекаем визит
  useEffect(() => {
    if (screen === 'landing') {
      track('landing_viewed');
    }
    if (screen === 'landing' && user) {
      loadAttempts(user.uid).then((entries) => {
        setProgressStats(calcStats(entries));
        setSolvedCaseIds(new Set(entries.map((e) => e.caseId)));
      });
    }
  }, [screen, user]);

  const resetForCase = (c: Case, resetAttempt = true) => {
    setActiveCase(c);
    setSolution(EMPTY_SOLUTION);
    setSelfReview({ confidence: 3, uncertainArea: '' });
    setFeedback(null);
    setPreviousFeedback(null);
    setUpgrade(null);
    setError(null);
    setFeedbackUseful(null);
    setNewBadges([]);
    if (resetAttempt) setAttemptNumber(1);
  };

  const startGuided = () => {
    // Если у пользователя есть решённые кейсы — открываем первый нерешённый
    const nextCase = solvedCaseIds.size > 0
      ? (cases.find((c) => !solvedCaseIds.has(c.id)) ?? guidedStarterCase)
      : guidedStarterCase;
    track('case_selected', { caseId: nextCase.id, caseTitle: nextCase.title });
    resetForCase(nextCase);
    setScreen('case');
  };

  const openBrowser = () => {
    track('case_browser_opened');
    setScreen('case-browser');
  };

  const selectFromBrowser = (c: Case) => {
    track('case_selected', { caseId: c.id, caseTitle: c.title });
    resetForCase(c);
    setScreen('case');
  };

  const goToSelfReview = () => {
    track('writing_started', { caseId: activeCase.id, attemptNumber });
    setScreen('self-review');
  };

  const analyze = useCallback(async () => {
    track('analyze_clicked', { caseId: activeCase.id, attemptNumber });
    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(60_000),
        body: JSON.stringify({
          caseId: activeCase.id,
          caseTitle: activeCase.title,
          caseDescription: activeCase.description,
          difficulty: activeCase.difficulty,
          skillFocus: activeCase.skillFocus,
          solution: joinSolutionFull(solution),
          selfReview,
          rubricVersion: 'v1',
        }),
      });
      if (!res.ok) {
        const e = await res.json();
        throw new Error(e.error || `HTTP ${res.status}`);
      }
      const data: FeedbackResponse = await res.json();
      const avg =
        Object.values(data.scores).reduce((a, b) => a + b, 0) /
        Object.values(data.scores).length;
      track('feedback_received', { caseId: activeCase.id, attemptNumber, avgScore: parseFloat(avg.toFixed(2)) });
      if (user) {
        const beforeEntries = await loadAttempts(user.uid);
        const before = buildGamification(beforeEntries);

        if (!data.isMock) {
          await saveAttempt(user.uid, {
            caseId: activeCase.id,
            caseTitle: activeCase.title,
            avgScore: avg,
            confidence: selfReview.confidence,
            rubricScores: data.scores as Record<string, number>,
          });
        }

        const afterEntries = await loadAttempts(user.uid);
        const after = buildGamification(afterEntries);
        const unlockedNow = after.unlockedBadgeIds.filter(
          (badgeId) => !before.unlockedBadgeIds.includes(badgeId)
        );
        setNewBadges(unlockedNow.map((badgeId) => getBadgeMeta(badgeId)));
        setProgressStats(calcStats(afterEntries));
      }
      setFeedback(data);
      setScreen('feedback');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Неизвестная ошибка';
      if (msg.startsWith('rate_limit:')) {
        const mins = msg.split(':')[1];
        setError(`Вы отправили слишком много запросов. Лимит обновится через ${mins} мин. Это сделано для защиты сервиса.`);
      } else if (msg.includes('timeout') || msg.includes('AbortError')) {
        setError('Анализ занял слишком долго. Попробуйте снова.');
      } else {
        setError(`Ошибка: ${msg}. Попробуйте снова.`);
      }
    } finally {
      setLoading(false);
    }
  }, [activeCase, solution, selfReview, attemptNumber, user]);

  const requestUpgrade = useCallback(async () => {
    if (!feedback) return;
    track('upgrade_clicked', { caseId: activeCase.id, attemptNumber });
    setUpgrade(null);        // сбрасываем старые данные
    setUpgradeLoading(true);
    setScreen('upgrade');    // сразу переходим на экран апгрейда — скелетон виден
    setError(null);

    try {
      const res = await fetch('/api/upgrade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(90_000),
        body: JSON.stringify({
          caseId: activeCase.id,
          caseTitle: activeCase.title,
          caseDescription: activeCase.description,
          difficulty: activeCase.difficulty,
          skillFocus: activeCase.skillFocus,
          originalSolution: joinSolutionFull(solution),
          feedback,
        }),
      });
      if (!res.ok) {
        const e = await res.json();
        throw new Error(e.error || `HTTP ${res.status}`);
      }
      const data: UpgradeResponse = await res.json();
      track('upgrade_received', { caseId: activeCase.id });
      // запоминаем что гость уже воспользовался апгрейдом
      if (!user && typeof window !== 'undefined') {
        localStorage.setItem('ct_guest_upgraded', '1');
        setGuestUpgradeUsed(true);
      }
      setUpgrade(data);
      setScreen('upgrade');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Неизвестная ошибка';
      if (msg.startsWith('rate_limit:')) {
        const mins = msg.split(':')[1];
        setError(`Вы отправили слишком много запросов. Лимит обновится через ${mins} мин. Это сделано для защиты сервиса.`);
      } else {
        setError(`Ошибка улучшения: ${msg}. Попробуйте снова.`);
      }
    } finally {
      setUpgradeLoading(false);
    }
  }, [activeCase, solution, feedback, attemptNumber]);

  const handleFeedbackUseful = (v: boolean) => {
    setFeedbackUseful(v);
    track(v ? 'feedback_useful' : 'feedback_not_useful', { caseId: activeCase.id });
  };

  const retry = () => {
    track('retry_started', { caseId: activeCase.id, attemptNumber });
    setAttemptNumber((n) => n + 1);
    setPreviousFeedback(feedback);
    setSolution(EMPTY_SOLUTION);
    setSelfReview({ confidence: 3, uncertainArea: '' });
    setFeedback(null);
    setUpgrade(null);
    setError(null);
    setFeedbackUseful(null);
    setNewBadges([]);
    setScreen('case');
  };

  const nextCase = () => {
    track('next_case_clicked', { caseId: activeCase.id });
    // Берём первый нерешённый кейс (не текущий), иначе случайный
    const next =
      cases.find((c) => c.id !== activeCase.id && !solvedCaseIds.has(c.id)) ??
      getRandomCase(activeCase.id);
    resetForCase(next);
    setScreen('case');
  };

  const goHome = () => {
    setScreen('landing');
  };

  const resetProgress = () => setProgressStats(null);

  const closeOnboarding = () => {
    if (user && typeof window !== 'undefined') {
      localStorage.setItem(`ct_onboarded_${user.uid}`, '1');
    }
    setShowOnboarding(false);
  };

  const handleLogOut = async () => {
    await logOut();
    router.push('/login');
  };

  return (
    <>
      {/* Онбординг-модалка для новых пользователей */}
      {showOnboarding && <OnboardingModal onClose={closeOnboarding} />}

      {/* Кнопки профиля / выхода */}
      <div className="fixed bottom-5 right-5 z-40 flex items-center gap-2">
        {user ? (
          <>
            {profile?.role === 'admin' && (
              <Link
                href="/admin"
                className="px-3 py-2 rounded-full bg-purple-100 border border-purple-200 shadow-md text-xs text-purple-700 hover:bg-purple-200 hover:shadow-lg transition-all"
                title="Дашборд преподавателя"
              >
                Админ
              </Link>
            )}
            <Link
              href="/profile"
              className="px-3 py-2 rounded-full bg-white border border-gray-200 shadow-md text-xs text-gray-500 hover:text-indigo-600 hover:shadow-lg transition-all"
              title="Профиль"
            >
              Профиль
            </Link>
            <Link
              href="/leaderboard"
              className="px-3 py-2 rounded-full bg-white border border-gray-200 shadow-md text-xs text-gray-500 hover:text-indigo-600 hover:shadow-lg transition-all"
              title="Лидерборд"
            >
              Топ-20
            </Link>
            <button
              onClick={handleLogOut}
              className="px-3 py-2 rounded-full bg-white border border-gray-200 shadow-md text-xs text-gray-500 hover:text-gray-800 hover:shadow-lg transition-all"
              title="Выйти"
            >
              Выйти
            </button>
          </>
        ) : (
          <>
            <Link
              href="/register"
              className="px-3 py-2 rounded-full bg-indigo-600 border border-indigo-700 shadow-md text-xs text-white hover:bg-indigo-700 hover:shadow-lg transition-all"
            >
              Регистрация
            </Link>
            <Link
              href="/login"
              className="px-3 py-2 rounded-full bg-white border border-gray-200 shadow-md text-xs text-gray-500 hover:text-gray-800 hover:shadow-lg transition-all"
            >
              Войти
            </Link>
            <Link
              href="/leaderboard"
              className="px-3 py-2 rounded-full bg-white border border-gray-200 shadow-md text-xs text-gray-500 hover:text-indigo-600 hover:shadow-lg transition-all"
            >
              Топ-20
            </Link>
          </>
        )}
      </div>
      {error && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl px-4 py-3 shadow-lg z-50 max-w-sm text-center">
          {error}
          <button onClick={() => setError(null)} className="ml-3 text-red-400 hover:text-red-600">✕</button>
        </div>
      )}

      {screen === 'landing' && (
        <LandingScreen
          onGuided={startGuided}
          onBrowse={openBrowser}
          progressStats={progressStats}
          onResetProgress={resetProgress}
          isLoggedIn={!!user}
          nextCaseTitle={solvedCaseIds.size > 0 ? (cases.find((c) => !solvedCaseIds.has(c.id))?.title) : undefined}
          allCasesSolved={!!user && solvedCaseIds.size >= cases.length}
        />
      )}
      {screen === 'case-browser' && (
        <CaseBrowserScreen onSelect={selectFromBrowser} onBack={() => setScreen('landing')} />
      )}
      {screen === 'case' && (
        <CaseScreen
          activeCase={activeCase}
          solution={solution}
          setSolution={setSolution}
          onAnalyze={goToSelfReview}
          onBack={() => setScreen('landing')}
          attemptNumber={attemptNumber}
          screen={screen}
        />
      )}
      {screen === 'self-review' && loading && (
        <FeedbackSkeletonScreen screen={screen} />
      )}
      {screen === 'self-review' && !loading && (
        <SelfReviewScreen
          selfReview={selfReview}
          setSelfReview={setSelfReview}
          onAnalyze={analyze}
          loading={loading}
          onBack={() => setScreen('case')}
          screen={screen}
          isGuest={!user}
        />
      )}
      {screen === 'upgrade' && upgradeLoading && (
        <UpgradeLoadingScreen activeCase={activeCase} screen='upgrade' />
      )}
      {screen === 'feedback' && feedback && !upgradeLoading && (
        <FeedbackScreen
          feedback={feedback}
          activeCase={activeCase}
          attemptNumber={attemptNumber}
          selfReview={selfReview}
          previousFeedback={previousFeedback}
          onRetry={retry}
          onNextCase={nextCase}
          onUpgrade={requestUpgrade}
          onHome={goHome}
          upgradeLoading={upgradeLoading}
          feedbackUseful={feedbackUseful}
          onFeedbackUseful={handleFeedbackUseful}
          isGuest={!user}
          guestUpgradeUsed={guestUpgradeUsed}
          newBadges={newBadges}
          screen={screen}
        />
      )}
      {screen === 'upgrade' && upgrade && (
        <UpgradeScreen
          upgrade={upgrade}
          activeCase={activeCase}
          originalSolution={joinSolution(solution)}
          onRetry={retry}
          onNextCase={nextCase}
          onHome={goHome}
          isGuest={!user}
        />
      )}
    </>
  );
}
