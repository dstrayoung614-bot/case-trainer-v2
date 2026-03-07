'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/app/lib/auth-context';

type FunnelStep = { event: string; count: number };
type DauRow = { date: string; users: number; events: number };
type TopCase = { caseId: number; title: string; selections: number; avgScore: number | null };
type Summary = {
  totalUsers: number;
  totalEvents: number;
  uniqueActiveUids: number;
  avgScoreAll: number | null;
  totalFeedbacks: number;
  totalUpgrades: number;
};

type AnalyticsData = {
  funnel: FunnelStep[];
  dau: DauRow[];
  topCases: TopCase[];
  summary: Summary;
};

const FUNNEL_LABELS: Record<string, string> = {
  landing_viewed:   'Открыл сайт',
  case_selected:    'Выбрал кейс',
  analyze_clicked:  'Отправил ответ',
  feedback_received:'Получил оценку',
  upgrade_clicked:  'Нажал «Улучшить»',
  upgrade_received: 'Получил апгрейд',
};

export default function AnalyticsPage() {
  const { user, profile, loading } = useAuth();
  const router = useRouter();
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!loading) {
      if (!user) { router.push('/login'); return; }
      if (profile && profile.role !== 'admin') { router.push('/'); return; }
    }
  }, [loading, user, profile, router]);

  useEffect(() => {
    if (!user || !profile || profile.role !== 'admin') return;
    fetch('/api/admin/analytics')
      .then((r) => r.json())
      .then((d) => {
        if (d.error) setError(d.error);
        else setData(d);
      })
      .catch(() => setError('Ошибка загрузки'))
      .finally(() => setFetching(false));
  }, [user, profile]);

  if (loading || fetching) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-red-600 text-sm">{error}</p>
      </div>
    );
  }

  if (!data) return null;

  const { funnel, dau, topCases, summary } = data;
  const funnelTop = Math.max(...funnel.map((f) => f.count), 1);
  const dauMax = Math.max(...dau.map((d) => d.events), 1);

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-10">
      <div className="max-w-4xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Аналитика</h1>
            <p className="text-sm text-gray-500 mt-0.5">Данные из Firestore в реальном времени</p>
          </div>
          <div className="flex gap-3">
            <Link href="/admin" className="text-sm text-gray-500 hover:text-gray-700">← Пользователи</Link>
          </div>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {[
            { label: 'Зарегистрированных', value: summary.totalUsers, color: 'text-indigo-600' },
            { label: 'Активных (с событиями)', value: summary.uniqueActiveUids, color: 'text-violet-600' },
            { label: 'Фидбеков получено', value: summary.totalFeedbacks, color: 'text-blue-600' },
            { label: 'Апгрейдов получено', value: summary.totalUpgrades, color: 'text-emerald-600' },
            { label: 'Средний балл', value: summary.avgScoreAll != null ? `${summary.avgScoreAll}/5` : '—', color: 'text-amber-600' },
            { label: 'Всего событий', value: summary.totalEvents, color: 'text-gray-600' },
          ].map((card) => (
            <div key={card.label} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
              <p className="text-xs text-gray-500">{card.label}</p>
              <p className={`text-2xl font-bold mt-1 ${card.color}`}>{card.value}</p>
            </div>
          ))}
        </div>

        {/* Funnel */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <h2 className="font-semibold text-gray-800 mb-1">Воронка конверсии</h2>
          <p className="text-xs text-gray-400 mb-5">Уникальные пользователи на каждом шаге</p>
          <div className="flex flex-col items-center gap-0">
            {funnel.map((step, i) => {
              const pct = funnelTop > 0 ? (step.count / funnelTop) * 100 : 0;
              // минимальная ширина 20%, максимальная 100%
              const barPct = Math.max(pct, step.count > 0 ? 20 : 8);
              const convFromPrev = i > 0 && funnel[i - 1].count > 0
                ? Math.round((step.count / funnel[i - 1].count) * 100)
                : null;
              const colors = [
                'bg-indigo-600',
                'bg-indigo-500',
                'bg-violet-500',
                'bg-violet-400',
                'bg-purple-400',
                'bg-purple-300',
              ];
              return (
                <div key={step.event} className="w-full flex flex-col items-center">
                  {/* Стрелка-разделитель с конверсией */}
                  {i > 0 && (
                    <div className="flex items-center gap-2 my-1">
                      {convFromPrev != null ? (
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                          convFromPrev >= 70 ? 'bg-emerald-100 text-emerald-700' :
                          convFromPrev >= 40 ? 'bg-amber-100 text-amber-700' :
                          'bg-red-100 text-red-600'
                        }`}>
                          ↓ {convFromPrev}%
                        </span>
                      ) : (
                        <span className="text-xs text-gray-300 px-2 py-0.5">↓</span>
                      )}
                    </div>
                  )}
                  {/* Блок воронки */}
                  <div
                    className={`${colors[i] ?? 'bg-gray-300'} rounded-lg transition-all flex items-center justify-between px-4 py-2.5`}
                    style={{ width: `${barPct}%`, minWidth: '160px' }}
                  >
                    <span className="text-white text-xs font-medium truncate mr-2">
                      <span className="opacity-60 mr-1">{i + 1}.</span>
                      {FUNNEL_LABELS[step.event] ?? step.event}
                    </span>
                    <span className="text-white font-bold text-sm flex-shrink-0">{step.count}</span>
                  </div>
                </div>
              );
            })}
          </div>
          {/* Итоговая конверсия */}
          {funnel[0]?.count > 0 && funnel[funnel.length - 1]?.count >= 0 && (
            <div className="mt-4 pt-4 border-t border-gray-100 flex justify-between text-sm">
              <span className="text-gray-500">Сквозная конверсия (сайт → апгрейд)</span>
              <span className="font-bold text-indigo-600">
                {Math.round((funnel[funnel.length - 1].count / funnel[0].count) * 100)}%
              </span>
            </div>
          )}
        </div>

        {/* DAU chart */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <h2 className="font-semibold text-gray-800 mb-4">Активность за 7 дней</h2>
          <div className="flex items-end gap-2 h-28">
            {dau.map((day) => {
              const h = Math.round((day.events / dauMax) * 100);
              return (
                <div key={day.date} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-[9px] text-gray-500">{day.events > 0 ? day.events : ''}</span>
                  <div className="w-full flex flex-col justify-end" style={{ height: '80px' }}>
                    <div
                      className="w-full bg-indigo-400 rounded-t transition-all"
                      style={{ height: `${h}%`, minHeight: day.events > 0 ? '4px' : '0' }}
                    />
                  </div>
                  <span className="text-[9px] text-gray-400 text-center leading-tight">{day.date}</span>
                  {day.users > 0 && (
                    <span className="text-[9px] text-indigo-500">{day.users}u</span>
                  )}
                </div>
              );
            })}
          </div>
          <p className="text-xs text-gray-400 mt-2">Столбец = события, u = уникальных пользователей</p>
        </div>

        {/* Top cases */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <h2 className="font-semibold text-gray-800 mb-4">Топ кейсов по популярности</h2>
          {topCases.length === 0 ? (
            <p className="text-sm text-gray-400">Пока нет данных</p>
          ) : (
            <div className="space-y-2">
              {topCases.map((c, i) => (
                <div key={c.caseId} className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0">
                  <span className="text-sm font-bold text-gray-300 w-5">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-800 truncate">{c.title}</p>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    {c.avgScore != null && (
                      <span className={`text-xs font-semibold ${
                        c.avgScore >= 4 ? 'text-emerald-600' :
                        c.avgScore >= 2.5 ? 'text-amber-600' : 'text-red-500'
                      }`}>
                        ⌀ {c.avgScore}
                      </span>
                    )}
                    <span className="text-sm font-bold text-indigo-600">{c.selections}</span>
                    <span className="text-xs text-gray-400">{(() => { const n = c.selections; const m10 = n % 10; const m100 = n % 100; if (m10 === 1 && m100 !== 11) return 'выбор'; if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return 'выбора'; return 'выборов'; })()}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
