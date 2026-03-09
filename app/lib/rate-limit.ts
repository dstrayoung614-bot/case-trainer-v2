// Простой in-memory rate limiter: 10 запросов в час на IP
// На Vercel каждый инстанс независим, но защищает от большинства злоупотреблений

const WINDOW_MS = 60 * 60 * 1000; // 1 час
const MAX_REQUESTS = 10;

const store = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(ip: string): { allowed: boolean; remaining: number; resetInMinutes: number } {
  const now = Date.now();
  const entry = store.get(ip);

  if (!entry || now > entry.resetAt) {
    store.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true, remaining: MAX_REQUESTS - 1, resetInMinutes: 60 };
  }

  if (entry.count >= MAX_REQUESTS) {
    const resetInMinutes = Math.ceil((entry.resetAt - now) / 60_000);
    return { allowed: false, remaining: 0, resetInMinutes };
  }

  entry.count += 1;
  return { allowed: true, remaining: MAX_REQUESTS - entry.count, resetInMinutes: Math.ceil((entry.resetAt - now) / 60_000) };
}
