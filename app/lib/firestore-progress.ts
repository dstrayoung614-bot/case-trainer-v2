import {
  collection,
  addDoc,
  getDocs,
  query,
  orderBy,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from './firebase';

export interface AttemptEntry {
  caseId: number;
  caseTitle: string;
  avgScore: number;
  confidence: number;
  ts: number;
  rubricScores?: Record<string, number>;
}

export async function saveAttempt(uid: string, entry: Omit<AttemptEntry, 'ts'>) {
  await addDoc(collection(db, 'users', uid, 'attempts'), {
    ...entry,
    ts: serverTimestamp(),
  });
}

export async function loadAttempts(uid: string): Promise<AttemptEntry[]> {
  const q = query(
    collection(db, 'users', uid, 'attempts'),
    orderBy('ts', 'desc')
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => {
    const data = d.data();
    return {
      caseId: data.caseId,
      caseTitle: data.caseTitle,
      avgScore: data.avgScore,
      confidence: data.confidence,
      ts: data.ts?.toMillis?.() ?? Date.now(),
      rubricScores: data.rubricScores ?? undefined,
    };
  });
}

export function calcStats(entries: AttemptEntry[]) {
  if (entries.length === 0) return null;
  return {
    total: entries.length,
    avgScore: entries.reduce((a, b) => a + b.avgScore, 0) / entries.length,
    uniqueCases: new Set(entries.map((e) => e.caseId)).size,
  };
}
