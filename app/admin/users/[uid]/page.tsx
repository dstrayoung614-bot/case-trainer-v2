'use client';

import { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/app/lib/auth-context';

const RUBRIC_LABELS: Record<string, string> = {
  problemFraming: 'Постановка',
  diagnosis: 'Диагностика',
  metricsThinking: 'Метрики',
  prioritization: 'Приоритизация',
  clarityStructure: 'Структура',
  tradeOffs: 'Риски',
};

interface AttemptDetail {
  id: string;
  caseId: number;
  caseTitle: string;
  avgScore: number;
  confidence: number;
  ts: number | null;
  rubricScores: Record<string, number> | null;
  solutionText: string | null;
}

interface UserDetail {
  uid: string;
  email: string;
  displayName: string;
  createdAt: number | null;
}

function ScoreBadge({ score }: { score: number }) {
  const color =
    score >= 4 ? 'bg-green-100 text-green-700' :
    score >= 2.5 ? 'bg-yellow-100 text-yellow-700' :
    score > 0 ? 'bg-red-100 text-red-700' :
    'bg-gray-100 text-gray-400';
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${color}`}>
      {score > 0 ? score.toFixed(1) : '—'}
    </span>
  );
}

function formatDate(ts: number | null) {
  if (!ts) return '—';
  return new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export default function AdminUserPage() {
  const { user, profile, loading } = useAuth();
  const router = useRouter();
  const params = useParams();
  const uid = params.uid as string;

  const [userDetail, setUserDetail] = useState<UserDetail | null>(null);
  const [attempts, setAttempts] = useState<AttemptDetail[]>([]);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (!loading) {
      if (!user) { router.push('/login'); return; }
      if (profile && profile.role !== 'admin') { router.push('/'); return; }
    }
  }, [loading, user, profile, router]);

  useEffect(() => {
    if (!user || !profile || profile.role !== 'admin' || !uid) return;
    fetch(`/api/admin/users/${uid}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) setError(data.error);
        else {
          setUserDetail(data.user);
          setAttempts(data.attempts ?? []);
        }
      })
      .catch(() => setError('Ошибка загрузки данных'))
      .finally(() => setFetching(false));
  }, [user, profile, uid]);

  if (loading || fetching) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-gray-400 text-sm">Загрузка...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-red-500 text-sm">{error}</div>
      </div>
    );
  }

  const avgScore = attempts.length
    ? attempts.reduce((s, a) => s + a.avgScore, 0) / attempts.length
    : 0;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/admin" className="text-sm text-gray-500 hover:text-gray-700">
            ← Студенты
          </Link>
          <h1 className="text-lg font-bold text-gray-900">
            {userDetail?.displayName || userDetail?.email || uid}
          </h1>
          <span className="bg-indigo-100 text-indigo-700 text-xs font-semibold px-2 py-0.5 rounded-full">ADMIN</span>
        </div>
        <div className="text-sm text-gray-400">{userDetail?.email}</div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8 space-y-6">

        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          {[
            { label: 'Попыток', value: attempts.length },
            { label: 'Уникальных кейсов', value: new Set(attempts.map(a => a.caseId)).size },
            { label: 'Средний балл', value: avgScore > 0 ? avgScore.toFixed(2) : '—', colored: true, score: avgScore },
          ].map((item) => (
            <div key={item.label} className="bg-white rounded-xl border border-gray-200 p-5 text-center">
              <div className={`text-3xl font-bold mb-1 ${
                item.colored
                  ? item.score! >= 4 ? 'text-green-600' : item.score! >= 2.5 ? 'text-yellow-600' : 'text-red-500'
                  : 'text-gray-900'
              }`}>{item.value}</div>
              <div className="text-xs text-gray-500">{item.label}</div>
            </div>
          ))}
        </div>

        {/* Attempts */}
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100">
            <h2 className="font-semibold text-gray-800">📋 Попытки</h2>
          </div>

          {attempts.length === 0 ? (
            <div className="px-6 py-12 text-center text-gray-400 text-sm">Попыток ещё нет</div>
          ) : (
            <div className="divide-y divide-gray-50">
              {attempts.map((attempt) => (
                <div key={attempt.id}>
                  {/* Row */}
                  <div
                    className="px-6 py-4 flex items-center gap-4 cursor-pointer hover:bg-gray-50 transition-colors"
                    onClick={() => setExpandedId(expandedId === attempt.id ? null : attempt.id)}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">{attempt.caseTitle}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{formatDate(attempt.ts)}</p>
                    </div>

                    {/* Rubric mini-bars */}
                    {attempt.rubricScores && (
                      <div className="hidden md:flex items-end gap-1 h-8">
                        {Object.entries(RUBRIC_LABELS).map(([key, label]) => {
                          const score = attempt.rubricScores![key] ?? 0;
                          const pct = (score / 5) * 100;
                          const color = score >= 4 ? 'bg-green-400' : score >= 3 ? 'bg-yellow-400' : score >= 1 ? 'bg-red-400' : 'bg-gray-200';
                          return (
                            <div key={key} className="flex flex-col items-center gap-0.5" title={`${label}: ${score}`}>
                              <div className="w-4 bg-gray-100 rounded-sm overflow-hidden" style={{ height: 28 }}>
                                <div
                                  className={`w-full rounded-sm ${color}`}
                                  style={{ height: `${pct}%`, marginTop: `${100 - pct}%` }}
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    <div className="flex items-center gap-3 flex-shrink-0">
                      <div className="text-xs text-gray-400">уверен. <span className="font-medium text-gray-600">{attempt.confidence}/5</span></div>
                      <ScoreBadge score={attempt.avgScore} />
                      <span className="text-gray-300 text-xs">{expandedId === attempt.id ? '▲' : '▼'}</span>
                    </div>
                  </div>

                  {/* Expanded: rubric + solution */}
                  {expandedId === attempt.id && (
                    <div className="px-6 pb-5 space-y-4 bg-gray-50 border-t border-gray-100">

                      {/* Rubric scores */}
                      {attempt.rubricScores && (
                        <div className="pt-4">
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Оценка по критериям</p>
                          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                            {Object.entries(RUBRIC_LABELS).map(([key, label]) => {
                              const score = attempt.rubricScores![key] ?? 0;
                              const color = score >= 4 ? 'text-green-600 bg-green-50' : score >= 3 ? 'text-yellow-700 bg-yellow-50' : score >= 1 ? 'text-red-600 bg-red-50' : 'text-gray-400 bg-gray-100';
                              return (
                                <div key={key} className={`flex items-center justify-between rounded-lg px-3 py-2 ${color}`}>
                                  <span className="text-xs font-medium">{label}</span>
                                  <span className="text-sm font-bold">{score}/5</span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {/* Solution text */}
                      {attempt.solutionText ? (
                        <div>
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Решение студента</p>
                          <div className="bg-white border border-gray-200 rounded-lg p-4 text-sm text-gray-700 whitespace-pre-wrap font-mono leading-relaxed max-h-96 overflow-y-auto">
                            {attempt.solutionText}
                          </div>
                        </div>
                      ) : (
                        <p className="text-xs text-gray-400 italic">Текст решения не сохранён (попытка до обновления)</p>
                      )}

                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
