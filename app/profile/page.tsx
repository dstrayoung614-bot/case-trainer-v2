'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '../lib/auth-context';
import { loadAttempts, AttemptEntry } from '../lib/firestore-progress';

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

// mini sparkline bar chart (last N attempts)
function ScoreSparkline({ entries }: { entries: AttemptEntry[] }) {
  if (entries.length < 2) return null;
  const recent = [...entries].reverse().slice(-12); // хронологический порядок, последние 12
  const max = 5;
  return (
    <div className="flex items-end gap-1 h-10">
      {recent.map((e, i) => {
        const pct = (e.avgScore / max) * 100;
        const color = e.avgScore >= 4 ? 'bg-emerald-400' : e.avgScore >= 3 ? 'bg-amber-400' : 'bg-red-400';
        return (
          <div key={i} className="flex-1 flex flex-col items-center justify-end gap-0.5" title={`${e.avgScore.toFixed(1)} — ${e.caseTitle}`}>
            <div className={`w-full rounded-sm ${color} transition-all`} style={{ height: `${pct}%` }} />
          </div>
        );
      })}
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
          <button onClick={handleLogOut} className="text-xs text-gray-400 hover:text-red-500 transition-colors">
            Выйти
          </button>
        </div>

        <div>
          <h1 className="text-2xl font-bold text-gray-900">Мой профиль</h1>
          <p className="text-sm text-gray-500 mt-0.5">{profile?.email}</p>
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
        {totalAttempts >= 2 && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-gray-800 text-sm">📈 Динамика</h2>
              {delta !== null && (
                <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                  delta > 0 ? 'bg-emerald-100 text-emerald-700' :
                  delta < 0 ? 'bg-red-100 text-red-700' :
                  'bg-gray-100 text-gray-600'
                }`}>
                  {delta > 0 ? '+' : ''}{delta.toFixed(1)} за последние 5
                </span>
              )}
            </div>
            <ScoreSparkline entries={attempts} />
            <p className="text-xs text-gray-400">Каждая полоска — одна попытка. Высота = балл (макс 5)</p>
          </div>
        )}

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
