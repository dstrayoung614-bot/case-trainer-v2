// In-memory rate limiter с поддержкой namespace (per-route счётчики)
// На Vercel каждый инстанс независим, но защищает от большинства злоупотреблений

const DEFAULT_WINDOW_MS = 60 * 60 * 1000; // 1 час
const DEFAULT_MAX_REQUESTS = 10;

const store = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(
  ip: string,
  options?: { namespace?: string; maxRequests?: number; windowMs?: number }
): { allowed: boolean; remaining: number; resetInMinutes: number } {
  const maxRequests = options?.maxRequests ?? DEFAULT_MAX_REQUESTS;
  const windowMs = options?.windowMs ?? DEFAULT_WINDOW_MS;
  // Namespace изолирует счётчики по роутам: одна IP не перекрывает лимиты разных эндпоинтов
  const key = options?.namespace ? `${options.namespace}:${ip}` : ip;

  const now = Date.now();
  const entry = store.get(key);

  if (!entry || now > entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: maxRequests - 1, resetInMinutes: Math.ceil(windowMs / 60_000) };
  }

  if (entry.count >= maxRequests) {
    const resetInMinutes = Math.ceil((entry.resetAt - now) / 60_000);
    return { allowed: false, remaining: 0, resetInMinutes };
  }

  entry.count += 1;
  return { allowed: true, remaining: maxRequests - entry.count, resetInMinutes: Math.ceil((entry.resetAt - now) / 60_000) };
}
