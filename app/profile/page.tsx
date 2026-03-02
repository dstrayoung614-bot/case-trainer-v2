'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '../lib/auth-context';
import { loadAttempts, AttemptEntry } from '../lib/firestore-progress';
import { buildGamification } from '../lib/gamification';

function ScoreBadge({ score }: { score: number }) {
  const color =
    score >= 4 ? 'bg-emerald-100 text-emerald-700' :
    score >= 3 ? 'bg-amber-100 text-amber-700' :
    'bg-red-100 text-red-700';
  return (
    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${color}`}>
      {score.toFixed(1)}
    </span>
  );
}

// scrollable bar chart — all attempts, tooltip on hover
function ScoreSparkline({ entries }: { entries: AttemptEntry[] }) {
  const chronological = [...entries].reverse(); // oldest → newest
  const [tooltip, setTooltip] = useState<{
    x: number; y: number; entry: AttemptEntry; idx: number;
  } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const outerRef = useRef<HTMLDivElement>(null);

  const max = 5;
  const min = 1;
  const minVisiblePct = 4;
  const toHeightPct = (score: number) => {
    const clamped = Math.min(max, Math.max(min, score));
    return Math.max(((clamped - min) / (max - min)) * 100, minVisiblePct);
  };

  // scroll to end on mount so latest attempt is visible
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollLeft = containerRef.current.scrollWidth;
    }
  }, [entries.length]);

  return (
    // outer: relative + overflow-visible so absolute tooltip escapes scroll container
    <div ref={outerRef} className="relative" style={{ overflow: 'visible' }}>
      {/* Y-axis + scrollable chart */}
      <div className="flex gap-1">
        {/* Y-axis labels */}
        <div className="h-24 flex flex-col justify-between text-[10px] text-gray-500 font-semibold pointer-events-none flex-shrink-0 pr-1">
          {[5, 4, 3, 2, 1].map((tick) => (
            <span key={tick} className="leading-none">{tick}</span>
          ))}
        </div>

        {/* Scrollable bars */}
        <div
          ref={containerRef}
          className="sparkline-scroll relative flex-1 h-24 overflow-y-hidden"
        >
          {/* Grid lines */}
          <div
            className="absolute inset-0 flex flex-col justify-between pointer-events-none"
            style={{ minWidth: Math.max(chronological.length * 18, 200) }}
          >
            {[5, 4, 3, 2, 1].map((tick) => (
              <div key={tick} className="border-t border-gray-100 w-full" />
            ))}
          </div>

          {/* Bars */}
          <div
            className="relative z-10 flex items-end gap-0.5 h-full px-0.5"
            style={{ minWidth: Math.max(chronological.length * 18, 200) }}
          >
            {chronological.map((e, i) => {
              const pct = toHeightPct(e.avgScore);
              const color = e.avgScore >= 4 ? 'bg-emerald-400 hover:bg-emerald-500' :
                            e.avgScore >= 3 ? 'bg-amber-400 hover:bg-amber-500' :
                            'bg-red-400 hover:bg-red-500';
              return (
                <div
                  key={i}
                  className="flex-shrink-0 h-full flex flex-col items-center justify-end cursor-pointer"
                  style={{ width: 14 }}
                  onMouseEnter={(ev) => {
                    if (!outerRef.current) return;
                    const barRect = (ev.currentTarget as HTMLElement).getBoundingClientRect();
                    const outerRect = outerRef.current.getBoundingClientRect();
                    setTooltip({
                      x: barRect.left - outerRect.left + barRect.width / 2,
                      y: barRect.top - outerRect.top,
                      entry: e,
                      idx: i + 1,
                    });
                  }}
                  onMouseLeave={() => setTooltip(null)}
                >
                  <div className={`w-full rounded-sm transition-all ${color}`} style={{ height: `${pct}%` }} />
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Tooltip — absolute sibling of scroll container, not clipped by it */}
      {tooltip && (
        <div
          className="absolute z-50 pointer-events-none"
          style={{
            left: tooltip.x,
            top: tooltip.y,
            transform: 'translate(-50%, calc(-100% - 8px))',
          }}
        >
          <div
            className="rounded-lg px-3 py-2 shadow-xl whitespace-nowrap space-y-0.5"
            style={{ background: '#111827', fontSize: 12 }}
          >
            <div style={{ fontWeight: 600, color: '#fff' }}>Попытка #{tooltip.idx} · {tooltip.entry.avgScore.toFixed(1)} / 5</div>
            <div style={{ color: 'rgba(255,255,255,0.75)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>{tooltip.entry.caseTitle || '—'}</div>
            <div style={{ color: 'rgba(255,255,255,0.55)' }}>{new Date(tooltip.entry.ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })}</div>
          </div>
          <div style={{ width: 8, height: 8, background: '#111827', transform: 'rotate(45deg)', margin: '-5px auto 0' }} />
        </div>
      )}
    </div>
  );
}

function formatDate(ts: number) {
  return new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

export default function ProfilePage() {
  const { user, profile, loading, logOut } = useAuth();
  const router = useRouter();
  const [attempts, setAttempts] = useState<AttemptEntry[]>([]);
  const [fetching, setFetching] = useState(true);

  useEffect(() => {
    if (!loading && !user) router.push('/login');
  }, [loading, user, router]);

  useEffect(() => {
    if (user) {
      loadAttempts(user.uid)
        .then(setAttempts)
        .finally(() => setFetching(false));
    }
  }, [user]);

  if (loading || fetching) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const totalAttempts = attempts.length;
  const avgScore = totalAttempts > 0
    ? attempts.reduce((a, b) => a + b.avgScore, 0) / totalAttempts
    : 0;
  const uniqueCases = new Set(attempts.map((e) => e.caseId)).size;
  const game = buildGamification(attempts);

  // динамика: последние 5 vs предыдущие 5
  const chronological = [...attempts].reverse();
  const last5 = chronological.slice(-5);
  const prev5 = chronological.slice(-10, -5);
  const last5avg = last5.length ? last5.reduce((a, b) => a + b.avgScore, 0) / last5.length : null;
  const prev5avg = prev5.length ? prev5.reduce((a, b) => a + b.avgScore, 0) / prev5.length : null;
  const delta = last5avg !== null && prev5avg !== null ? last5avg - prev5avg : null;

  // группировка по кейсам
  const byCase = new Map<number, AttemptEntry[]>();
  for (const e of attempts) {
    if (!byCase.has(e.caseId)) byCase.set(e.caseId, []);
    byCase.get(e.caseId)!.push(e);
  }
  const caseStats = Array.from(byCase.entries())
    .map(([caseId, entries]) => ({
      caseId,
      caseTitle: entries[0].caseTitle,
      attempts: entries.length,
      best: Math.max(...entries.map((e) => e.avgScore)),
      last: entries[0].avgScore, // desc order, so first = latest
    }))
    .sort((a, b) => b.last - a.last);

  const handleLogOut = async () => {
    await logOut();
    router.push('/login');
  };

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-10">
      <div className="max-w-2xl mx-auto space-y-6">

        {/* header */}
        <div className="flex items-center justify-between">
          <Link href="/" className="text-gray-400 hover:text-gray-600 text-sm">← На главную</Link>
          <div className="flex items-center gap-4">
            <Link href="/leaderboard" className="text-xs text-gray-400 hover:text-indigo-600 transition-colors">Leaderboard</Link>
            <button onClick={handleLogOut} className="text-xs text-gray-400 hover:text-red-500 transition-colors">
              Выйти
            </button>
          </div>
        </div>

        <div>
          <h1 className="text-2xl font-bold text-gray-900">Мой профиль</h1>
          <p className="text-sm text-gray-500 mt-0.5">{profile?.email}</p>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-gray-500 uppercase tracking-wide">Уровень</p>
              <p className="text-xl font-bold text-gray-900 mt-1">{game.level}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-gray-500">Лучшая серия</p>
              <p className="text-lg font-semibold text-amber-600 mt-1">🔥 {game.longestStreakDays} дн.</p>
            </div>
          </div>
        </div>

        {/* stats cards */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { value: totalAttempts, label: 'попыток' },
            { value: uniqueCases, label: 'кейсов' },
            {
              value: totalAttempts ? avgScore.toFixed(1) : '—',
              label: 'средний балл',
              colored: totalAttempts > 0,
              score: avgScore,
            },
          ].map((s) => (
            <div key={s.label} className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 text-center">
              <div className={`text-2xl font-bold ${
                s.colored
                  ? s.score! >= 4 ? 'text-emerald-600' : s.score! >= 3 ? 'text-amber-600' : 'text-red-500'
                  : 'text-gray-900'
              }`}>
                {s.value}
              </div>
              <div className="text-xs text-gray-500 mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>

        {/* dynamics */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-gray-800 text-sm">📈 Динамика</h2>
            {/* show change vs prev 5, or avg of last 5 if not enough data */}
            {delta !== null ? (
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                delta > 0 ? 'bg-emerald-100 text-emerald-700' :
                delta < 0 ? 'bg-red-100 text-red-700' :
                'bg-gray-100 text-gray-500'
              }`}>
                {delta > 0 ? `↑ +${delta.toFixed(1)}` : delta < 0 ? `↓ ${delta.toFixed(1)}` : '→ без изменений'}
                {delta !== 0 && ' за посл. 5'}
              </span>
            ) : last5avg !== null ? (
              <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">
                ср. {last5avg.toFixed(1)} за посл. 5
              </span>
            ) : null}
          </div>
          <ScoreSparkline entries={attempts} />
          <p className="text-xs text-gray-400">Каждая полоска — одна попытка. Высота = балл (макс 5)</p>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-800 text-sm">🏅 Бейджи</h2>
          </div>
          <div className="divide-y divide-gray-50">
            {game.badges.map((badge) => (
              <div key={badge.id} className="px-5 py-3.5 flex items-center gap-4">
                <div className="text-xl">{badge.icon}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800">{badge.title}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{badge.description}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className={`text-xs font-semibold ${badge.unlocked ? 'text-emerald-600' : 'text-gray-400'}`}>
                    {badge.unlocked ? 'Получен' : 'В процессе'}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">{badge.progressText}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* per-case breakdown */}
        {caseStats.length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-800 text-sm">🗂 По кейсам</h2>
            </div>
            <div className="divide-y divide-gray-50">
              {caseStats.map((c) => (
                <div key={c.caseId} className="px-5 py-3.5 flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">{c.caseTitle}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{c.attempts} {c.attempts === 1 ? 'попытка' : c.attempts < 5 ? 'попытки' : 'попыток'}</p>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="text-xs text-gray-400">лучший</span>
                    <ScoreBadge score={c.best} />
                    {c.attempts > 1 && (
                      <>
                        <span className="text-xs text-gray-400">посл.</span>
                        <ScoreBadge score={c.last} />
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* attempt history */}
        {attempts.length > 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-800 text-sm">🕐 История попыток</h2>
            </div>
            <div className="divide-y divide-gray-50">
              {attempts.map((e, i) => (
                <div key={i} className="px-5 py-3.5 flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-800 truncate">{e.caseTitle}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{formatDate(e.ts)}</p>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <div className="text-xs text-gray-400">
                      уверенность <span className="font-medium text-gray-600">{e.confidence}/5</span>
                    </div>
                    <ScoreBadge score={e.avgScore} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-10 text-center space-y-3">
            <p className="text-3xl">📭</p>
            <p className="text-gray-500 text-sm">Попыток ещё нет</p>
            <Link href="/" className="inline-block text-sm text-indigo-600 font-medium hover:underline">
              Начать первый кейс →
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
