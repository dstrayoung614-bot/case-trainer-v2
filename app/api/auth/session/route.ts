import { NextRequest, NextResponse } from 'next/server';
import { adminAuth } from '@/app/lib/firebase-admin';

// POST /api/auth/session — создаёт сессионную куку
export async function POST(req: NextRequest) {
  if (!adminAuth) return NextResponse.json({ error: 'Auth not configured' }, { status: 503 });
  try {
    const { idToken } = await req.json();
    if (!idToken) return NextResponse.json({ error: 'No token' }, { status: 400 });

    // Верифицируем токен через Admin SDK
    await adminAuth.verifyIdToken(idToken);

    // Создаём сессионную куку (5 дней)
    const expiresIn = 60 * 60 * 24 * 5 * 1000;
    const sessionCookie = await adminAuth.createSessionCookie(idToken, { expiresIn });

    const res = NextResponse.json({ ok: true });
    res.cookies.set('session', sessionCookie, {
      maxAge: expiresIn / 1000,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      sameSite: 'lax',
    });
    return res;
  } catch (err) {
    console.error('[session] error:', err);
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
}

// DELETE /api/auth/session — удаляет сессионную куку
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set('session', '', { maxAge: 0, path: '/' });
  return res;
}
