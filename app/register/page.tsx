'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '../lib/auth-context';

export default function RegisterPage() {
  const { signUp } = useAuth();
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    if (password !== confirm) {
      setError('Пароли не совпадают');
      return;
    }
    if (password.length < 6) {
      setError('Пароль должен быть не менее 6 символов');
      return;
    }

    setLoading(true);
    try {
      await signUp(email, password, displayName);
      router.replace('/');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Ошибка регистрации';
      if (msg.includes('email-already-in-use')) {
        setError('Этот email уже зарегистрирован');
      } else if (msg.includes('invalid-email')) {
        setError('Некорректный email');
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-indigo-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-bold text-gray-900">CaseTrainer</h1>
          <p className="text-sm text-gray-500">Создайте аккаунт — это бесплатно</p>
        </div>

        {/* Value props */}
        <div className="grid grid-cols-3 gap-2 text-center">
          {[
            { icon: '📝', text: '40 кейсов' },
            { icon: '🤖', text: 'AI-фидбек' },
            { icon: '📊', text: 'Прогресс' },
          ].map((item) => (
            <div key={item.text} className="bg-white rounded-xl py-2 px-1 border border-gray-100 shadow-sm">
              <div className="text-lg">{item.icon}</div>
              <div className="text-xs text-gray-600 font-medium mt-0.5">{item.text}</div>
            </div>
          ))}
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Никнейм</label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                placeholder="Как вас показывать в рейтинге?"
                maxLength={30}
              />
              <p className="text-xs text-gray-400">Необязательно — можно оставить пустым</p>
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                placeholder="you@example.com"
              />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Пароль</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                placeholder="Минимум 6 символов"
              />
            </div>

            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700">Повторите пароль</label>
              <input
                type="password"
                required
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                placeholder="••••••••"
              />
            </div>

            {error && (
              <p className="text-sm text-red-500 bg-red-50 rounded-lg px-3 py-2">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white font-semibold py-2.5 rounded-xl transition-colors"
            >
              {loading ? 'Создаю аккаунт...' : 'Зарегистрироваться'}
            </button>
          </form>
        </div>

        <p className="text-center text-sm text-gray-500">
          Уже есть аккаунт?{' '}
          <Link href="/login" className="text-indigo-600 font-medium hover:underline">
            Войти
          </Link>
        </p>
      </div>
    </div>
  );
}
