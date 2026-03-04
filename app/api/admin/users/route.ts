import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/app/lib/firebase-admin';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  if (!adminAuth || !adminDb) return NextResponse.json({ error: 'Auth not configured' }, { status: 503 });
  // 1. Проверяем сессию
  const session = req.cookies.get('session')?.value;
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // 2. Верифицируем токен
    const decoded = await adminAuth.verifySessionCookie(session, true);

    // 3. Проверяем роль в Firestore
    const requesterDoc = await adminDb.doc(`users/${decoded.uid}`).get();
    if (!requesterDoc.exists || requesterDoc.data()?.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // 4. Получаем всех пользователей
    const usersSnap = await adminDb.collection('users').orderBy('createdAt', 'desc').get();

    const users = await Promise.all(
      usersSnap.docs.map(async (userDoc) => {
        const userData = userDoc.data();

        // Получаем попытки пользователя
        const attemptsSnap = await adminDb
          .collection('users')
          .doc(userDoc.id)
          .collection('attempts')
          .orderBy('ts', 'desc')
          .get();

        const attempts = attemptsSnap.docs.map((a) => a.data());
        const totalAttempts = attempts.length;
        const avgScore =
          totalAttempts > 0
            ? attempts.reduce((sum, a) => sum + (a.avgScore ?? 0), 0) / totalAttempts
            : 0;
        const uniqueCases = new Set(attempts.map((a) => a.caseId)).size;
        const lastAttemptTs = attempts[0]?.ts?.toMillis?.() ?? null;

        return {
          uid: userDoc.id,
          email: userData.email ?? '',
          role: userData.role ?? 'student',
          createdAt: userData.createdAt?.toMillis?.() ?? null,
          totalAttempts,
          avgScore: Math.round(avgScore * 10) / 10,
          uniqueCases,
          lastAttemptTs,
        };
      })
    );

    return NextResponse.json({ users });
  } catch (err) {
    console.error('[admin/users]', err);
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
}
