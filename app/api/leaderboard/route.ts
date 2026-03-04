import { NextResponse } from 'next/server';
import { adminDb } from '@/app/lib/firebase-admin';
import { buildGamification } from '@/app/lib/gamification';
import { AttemptEntry } from '@/app/lib/firestore-progress';

export const dynamic = 'force-dynamic';

type LeaderboardItem = {
  uid: string;
  name: string;
  avgScore: number;
  totalAttempts: number;
  uniqueCases: number;
  level: string;
};

export async function GET() {
  if (!adminDb) return NextResponse.json({ leaderboard: [] });
  const db = adminDb; // capture non-null reference for use inside async callbacks
  try {
    const usersSnap = await db.collection('users').get();

    const rows = await Promise.all(
      usersSnap.docs.map(async (userDoc) => {
        const userData = userDoc.data();
        const attemptsSnap = await db
          .collection('users')
          .doc(userDoc.id)
          .collection('attempts')
          .get();

        const attempts: AttemptEntry[] = attemptsSnap.docs.map((doc) => {
          const data = doc.data();
          return {
            caseId: data.caseId ?? 0,
            caseTitle: data.caseTitle ?? '',
            avgScore: data.avgScore ?? 0,
            confidence: data.confidence ?? 0,
            ts: data.ts?.toMillis?.() ?? Date.now(),
          };
        });

        const game = buildGamification(attempts);
        if (game.totalAttempts === 0) return null;

        const displayName =
          typeof userData.displayName === 'string' && userData.displayName.trim().length > 0
            ? userData.displayName.trim()
            : '';
        const email = typeof userData.email === 'string' ? userData.email : '';
        const fallback = email.includes('@') ? email.split('@')[0] : 'User';

        const row: LeaderboardItem = {
          uid: userDoc.id,
          name: displayName || fallback,
          avgScore: game.avgScore,
          totalAttempts: game.totalAttempts,
          uniqueCases: game.uniqueCases,
          level: game.level,
        };

        return row;
      })
    );

    const leaderboard = rows
      .filter((row): row is LeaderboardItem => row !== null)
      .sort((a, b) => {
        if (b.avgScore !== a.avgScore) return b.avgScore - a.avgScore;
        if (b.uniqueCases !== a.uniqueCases) return b.uniqueCases - a.uniqueCases;
        return b.totalAttempts - a.totalAttempts;
      })
      .slice(0, 20)
      .map((row, index) => ({
        rank: index + 1,
        ...row,
        avgScore: Math.round(row.avgScore * 100) / 100,
      }));

    return NextResponse.json({ leaderboard });
  } catch (err) {
    console.error('[leaderboard]', err);
    return NextResponse.json({ error: 'Failed to load leaderboard' }, { status: 500 });
  }
}
