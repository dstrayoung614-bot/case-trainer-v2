'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

type LeaderboardEntry = {
  rank: number;
  uid: string;
  name: string;
  email: string;
  avgScore: number;
  totalAttempts: number;
  uniqueCases: number;
  level: string;
};

export default function LeaderboardPage() {
  const [rows, setRows] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/leaderboard', { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error('Не удалось загрузить рейтинг');
        const data = await res.json();
        setRows(data.leaderboard ?? []);
      })
      .catch((err) => {
        const msg = err instanceof Error ? err.message : 'Ошибка загрузки';
        setError(msg);
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-10">
      <div className="max-w-3xl mx-auto space-y-5">
        <div className="flex items-center justify-between">
          <Link href="/" className="text-gray-400 hover:text-gray-600 text-sm">← На главную</Link>
          <Link href="/profile" className="text-xs text-gray-400 hover:text-indigo-600 transition-colors">Мой профиль</Link>
        </div>

        <div>
          <h1 className="text-2xl font-bold text-gray-900">Leaderboard</h1>
          <p className="text-sm text-gray-500 mt-0.5">Топ-20 по среднему баллу</p>
        </div>

        {loading && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-10 flex items-center justify-center">
            <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {!loading && error && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {!loading && !error && (
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="grid grid-cols-12 gap-2 px-4 py-3 border-b border-gray-100 text-xs text-gray-400 font-semibold uppercase tracking-wide">
              <div className="col-span-1">#</div>
              <div className="col-span-4">Участник</div>
              <div className="col-span-2 text-right">Ср. балл</div>
              <div className="col-span-2 text-right">Попытки</div>
              <div className="col-span-1 text-right">Кейсы</div>
              <div className="col-span-2 text-right">Уровень</div>
            </div>

            {rows.length === 0 ? (
              <div className="p-10 text-center text-sm text-gray-500">Пока нет данных для рейтинга</div>
            ) : (
              <div className="divide-y divide-gray-50">
                {rows.map((row) => (
                  <div key={row.uid} className="grid grid-cols-12 gap-2 px-4 py-3 items-center text-sm">
                    <div className="col-span-1 font-semibold text-gray-700">{row.rank}</div>
                    <div className="col-span-4 min-w-0">
                      <p className="font-medium text-gray-800 truncate">{row.name}</p>
                      <p className="text-xs text-gray-400 truncate">{row.email}</p>
                    </div>
                    <div className={`col-span-2 text-right font-semibold ${
                      row.avgScore >= 4 ? 'text-emerald-600' : row.avgScore >= 3 ? 'text-amber-600' : 'text-red-500'
                    }`}>
                      {row.avgScore.toFixed(2)}
                    </div>
                    <div className="col-span-2 text-right text-gray-700">{row.totalAttempts}</div>
                    <div className="col-span-1 text-right text-gray-700">{row.uniqueCases}</div>
                    <div className="col-span-2 text-right text-gray-600 text-xs">{row.level}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
