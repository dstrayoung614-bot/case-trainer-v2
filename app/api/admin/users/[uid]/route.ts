import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/app/lib/firebase-admin';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: { uid: string } }
) {
  if (!adminAuth || !adminDb) return NextResponse.json({ error: 'Auth not configured' }, { status: 503 });
  const db = adminDb;

  const session = req.cookies.get('session')?.value;
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const decoded = await adminAuth.verifySessionCookie(session, true);
    const requesterDoc = await db.doc(`users/${decoded.uid}`).get();
    if (!requesterDoc.exists || requesterDoc.data()?.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const targetUid = params.uid;
    const userDoc = await db.doc(`users/${targetUid}`).get();
    if (!userDoc.exists) return NextResponse.json({ error: 'User not found' }, { status: 404 });

    const userData = userDoc.data()!;

    const attemptsSnap = await db
      .collection('users')
      .doc(targetUid)
      .collection('attempts')
      .orderBy('ts', 'desc')
      .get();

    const attempts = attemptsSnap.docs.map((doc) => {
      const d = doc.data();
      return {
        id: doc.id,
        caseId: d.caseId ?? 0,
        caseTitle: d.caseTitle ?? '',
        avgScore: d.avgScore ?? 0,
        confidence: d.confidence ?? 0,
        ts: d.ts?.toMillis?.() ?? null,
        rubricScores: d.rubricScores ?? null,
        solutionText: d.solutionText ?? null,
      };
    });

    return NextResponse.json({
      user: {
        uid: targetUid,
        email: userData.email ?? '',
        displayName: userData.displayName ?? '',
        createdAt: userData.createdAt?.toMillis?.() ?? null,
      },
      attempts,
    });
  } catch (err) {
    console.error('[admin/users/[uid]]', err);
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
}
