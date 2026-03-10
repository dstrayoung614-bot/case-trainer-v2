import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb } from '@/app/lib/firebase-admin';

export const dynamic = 'force-dynamic';

const FUNNEL_STEPS = [
  'landing_viewed',
  'case_selected',
  'analyze_clicked',
  'feedback_received',
  'upgrade_clicked',
  'upgrade_received',
] as const;

export async function GET(req: NextRequest) {
  if (!adminAuth || !adminDb) {
    return NextResponse.json({ error: 'Auth not configured' }, { status: 503 });
  }
  const db = adminDb;

  const session = req.cookies.get('session')?.value;
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const decoded = await adminAuth.verifySessionCookie(session, true);
    const requesterDoc = await db.doc(`users/${decoded.uid}`).get();
    if (!requesterDoc.exists || requesterDoc.data()?.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Читаем все события
    const eventsSnap = await db.collection('events').orderBy('ts', 'desc').get();
    const events = eventsSnap.docs.map((d) => {
      const data = d.data();
      return {
        event: data.event as string,
        uid: data.uid as string,
        caseId: data.caseId as number | undefined,
        caseTitle: data.caseTitle as string | undefined,
        avgScore: data.avgScore as number | undefined,
        ts: data.ts?.toMillis?.() ?? 0,
      };
    });

    // 1. Воронка — уникальные uid на каждом шаге
    const funnel = FUNNEL_STEPS.map((step) => {
      const uids = new Set(events.filter((e) => e.event === step).map((e) => e.uid));
      return { event: step, count: uids.size };
    });

    // 2. DAU за последние 7 дней
    const now = Date.now();
    const dau: { date: string; users: number; events: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const dayStart = now - i * 86400000;
      const dayEnd = dayStart + 86400000;
      const dayEvents = events.filter((e) => e.ts >= dayStart && e.ts < dayEnd);
      const uniqueUids = new Set(dayEvents.map((e) => e.uid));
      const date = new Date(dayStart).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
      dau.push({ date, users: uniqueUids.size, events: dayEvents.length });
    }

    // 3. Топ кейсов по числу выборов
    const caseMap: Record<string, { title: string; count: number; avgScore: number; scores: number[] }> = {};
    for (const e of events) {
      if (e.event === 'case_selected' && e.caseId != null) {
        const key = String(e.caseId);
        if (!caseMap[key]) caseMap[key] = { title: e.caseTitle ?? `Кейс ${e.caseId}`, count: 0, avgScore: 0, scores: [] };
        caseMap[key].count++;
      }
      if (e.event === 'feedback_received' && e.caseId != null && e.avgScore != null) {
        const key = String(e.caseId);
        if (caseMap[key]) caseMap[key].scores.push(e.avgScore);
      }
    }
    const topCases = Object.entries(caseMap)
      .map(([id, data]) => ({
        caseId: Number(id),
        title: data.title,
        selections: data.count,
        avgScore: data.scores.length > 0
          ? parseFloat((data.scores.reduce((a, b) => a + b, 0) / data.scores.length).toFixed(2))
          : null,
      }))
      .sort((a, b) => b.selections - a.selections)
      .slice(0, 10);

    // 4. Всего зарегистрированных пользователей
    const usersSnap = await db.collection('users').get();
    const totalUsers = usersSnap.size;

    // 5. Общая статистика
    const totalEvents = events.length;
    const uniqueActiveUids = new Set(events.map((e) => e.uid)).size;
    const feedbackEvents = events.filter((e) => e.event === 'feedback_received' && e.avgScore != null);
    const avgScoreAll = feedbackEvents.length > 0
      ? parseFloat((feedbackEvents.reduce((a, b) => a + (b.avgScore ?? 0), 0) / feedbackEvents.length).toFixed(2))
      : null;

    return NextResponse.json({
      funnel,
      dau,
      topCases,
      summary: {
        totalUsers,
        totalEvents,
        uniqueActiveUids,
        avgScoreAll,
        totalFeedbacks: feedbackEvents.length,
        uniqueFeedbackUids: new Set(feedbackEvents.map((e) => e.uid)).size,
        totalUpgrades: events.filter((e) => e.event === 'upgrade_received').length,
        uniqueUpgradeUids: new Set(events.filter((e) => e.event === 'upgrade_received').map((e) => e.uid)).size,
      },
    });
  } catch (err) {
    console.error('[analytics]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
