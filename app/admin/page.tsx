'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/app/lib/auth-context';

interface UserRow {
  uid: string;
  email: string;
  role: 'student' | 'admin';
  createdAt: number | null;
  totalAttempts: number;
  avgScore: number;
  uniqueCases: number;
  lastAttemptTs: number | null;
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
  return new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

export default function AdminPage() {
  const { user, profile, loading } = useAuth();
  const router = useRouter();

  const [users, setUsers] = useState<UserRow[]>([]);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<keyof UserRow>('createdAt');
  const [sortAsc, setSortAsc] = useState(false);

  // Защита: только admin
  useEffect(() => {
    if (!loading) {
      if (!user) { router.push('/login'); return; }
      if (profile && profile.role !== 'admin') { router.push('/'); return; }
    }
  }, [loading, user, profile, router]);

  useEffect(() => {
    if (!user || !profile || profile.role !== 'admin') return;

    fetch('/api/admin/users')
      .then((r) => r.json())
      .then((data) => {
        if (data.error) setError(data.error);
        else setUsers(data.users ?? []);
      })
      .catch(() => setError('Ошибка загрузки данных'))
      .finally(() => setFetching(false));
  }, [user, profile]);

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

  // Фильтрация
  const filtered = users.filter((u) =>
    u.email.toLowerCase().includes(search.toLowerCase())
  );

  // Сортировка
  const sorted = [...filtered].sort((a, b) => {
    const av = a[sortKey] ?? 0;
    const bv = b[sortKey] ?? 0;
    if (av < bv) return sortAsc ? -1 : 1;
    if (av > bv) return sortAsc ? 1 : -1;
    return 0;
  });

  const totalUsers = users.length;
  const activeUsers = users.filter((u) => u.totalAttempts > 0).length;
  const avgScoreAll =
    activeUsers > 0
      ? users.filter((u) => u.totalAttempts > 0).reduce((s, u) => s + u.avgScore, 0) / activeUsers
      : 0;
  const totalAttempts = users.reduce((s, u) => s + u.totalAttempts, 0);

  function toggleSort(key: keyof UserRow) {
    if (sortKey === key) setSortAsc((v) => !v);
    else { setSortKey(key); setSortAsc(false); }
  }

  const SortIcon = ({ k }: { k: keyof UserRow }) =>
    sortKey === k ? (sortAsc ? ' ↑' : ' ↓') : '';

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/" className="text-sm text-gray-500 hover:text-gray-700">
            ← На главную
          </Link>
          <h1 className="text-lg font-bold text-gray-900">Дашборд преподавателя</h1>
          <span className="bg-indigo-100 text-indigo-700 text-xs font-semibold px-2 py-0.5 rounded-full">
            ADMIN
          </span>
        </div>
        <div className="text-sm text-gray-500">{profile?.email}</div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-8">
        {/* Сводная статистика */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { label: 'Всего студентов', value: totalUsers },
            { label: 'Активных', value: activeUsers, sub: 'решили хотя бы 1 кейс' },
            { label: 'Попыток всего', value: totalAttempts },
            {
              label: 'Средний балл',
              value: avgScoreAll > 0 ? avgScoreAll.toFixed(1) : '—',
              colored: true,
              score: avgScoreAll,
            },
          ].map((item) => (
            <div key={item.label} className="bg-white rounded-xl border border-gray-200 p-5 text-center">
              <div
                className={`text-3xl font-bold mb-1 ${
                  item.colored
                    ? item.score >= 4
                      ? 'text-green-600'
                      : item.score >= 2.5
                      ? 'text-yellow-600'
                      : 'text-red-500'
                    : 'text-gray-900'
                }`}
              >
                {item.value}
              </div>
              <div className="text-xs text-gray-500">{item.label}</div>
              {item.sub && <div className="text-xs text-gray-400 mt-0.5">{item.sub}</div>}
            </div>
          ))}
        </div>

        {/* Таблица пользователей */}
        <div className="bg-white rounded-xl border border-gray-200">
          <div className="px-6 py-4 border-b border-gray-100 flex flex-col md:flex-row md:items-center gap-3 justify-between">
            <h2 className="font-semibold text-gray-800">👥 Студенты ({filtered.length})</h2>
            <input
              type="text"
              placeholder="Поиск по email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm w-full md:w-64 focus:outline-none focus:ring-2 focus:ring-indigo-300"
            />
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-400 border-b border-gray-100">
                  <th className="text-left px-6 py-3 font-medium">Email</th>
                  <th className="text-left px-4 py-3 font-medium">Роль</th>
                  <th
                    className="text-center px-4 py-3 font-medium cursor-pointer hover:text-gray-600"
                    onClick={() => toggleSort('totalAttempts')}
                  >
                    Попыток{SortIcon({ k: 'totalAttempts' })}
                  </th>
                  <th
                    className="text-center px-4 py-3 font-medium cursor-pointer hover:text-gray-600"
                    onClick={() => toggleSort('uniqueCases')}
                  >
                    Кейсов{SortIcon({ k: 'uniqueCases' })}
                  </th>
                  <th
                    className="text-center px-4 py-3 font-medium cursor-pointer hover:text-gray-600"
                    onClick={() => toggleSort('avgScore')}
                  >
                    Ср. балл{SortIcon({ k: 'avgScore' })}
                  </th>
                  <th
                    className="text-center px-4 py-3 font-medium cursor-pointer hover:text-gray-600"
                    onClick={() => toggleSort('lastAttemptTs')}
                  >
                    Последний вход{SortIcon({ k: 'lastAttemptTs' })}
                  </th>
                  <th
                    className="text-center px-4 py-3 font-medium cursor-pointer hover:text-gray-600"
                    onClick={() => toggleSort('createdAt')}
                  >
                    Зарегистрирован{SortIcon({ k: 'createdAt' })}
                  </th>
                </tr>
              </thead>
              <tbody>
                {sorted.length === 0 && (
                  <tr>
                    <td colSpan={7} className="text-center text-gray-400 py-12 text-sm">
                      Пользователи не найдены
                    </td>
                  </tr>
                )}
                {sorted.map((u) => (
                  <tr key={u.uid} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="px-6 py-3 text-gray-800 font-medium">{u.email}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                          u.role === 'admin'
                            ? 'bg-purple-100 text-purple-700'
                            : 'bg-gray-100 text-gray-500'
                        }`}
                      >
                        {u.role}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center text-gray-700">{u.totalAttempts || '—'}</td>
                    <td className="px-4 py-3 text-center text-gray-700">{u.uniqueCases || '—'}</td>
                    <td className="px-4 py-3 text-center">
                      <ScoreBadge score={u.avgScore} />
                    </td>
                    <td className="px-4 py-3 text-center text-gray-500">
                      {formatDate(u.lastAttemptTs)}
                    </td>
                    <td className="px-4 py-3 text-center text-gray-500">
                      {formatDate(u.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Инструкция для назначения admin */}
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 text-sm text-amber-800">
          <strong>Как назначить admin:</strong> Откройте{' '}
          <a
            href="https://console.firebase.google.com"
            target="_blank"
            rel="noreferrer"
            className="underline"
          >
            Firebase Console
          </a>{' '}
          → Firestore Database → коллекция <code className="bg-amber-100 px-1 rounded">users</code> →
          найдите нужного пользователя → измените поле <code className="bg-amber-100 px-1 rounded">role</code> с{' '}
          <code className="bg-amber-100 px-1 rounded">student</code> на{' '}
          <code className="bg-amber-100 px-1 rounded">admin</code>.
        </div>
      </main>
    </div>
  );
}
