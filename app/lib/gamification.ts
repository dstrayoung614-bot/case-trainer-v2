import { cases } from './cases';
import { AttemptEntry } from './firestore-progress';

export type LevelName = 'Новичок' | 'Любитель' | 'Практик' | 'Специалист' | 'Эксперт' | 'Мастер';

export type BadgeId =
  | 'first_case'
  | 'streak_runner'
  | 'perfectionist'
  | 'experienced'
  | 'master_topic';

export type BadgeMeta = {
  id: BadgeId;
  icon: string;
  title: string;
  description: string;
};

export type BadgeProgress = BadgeMeta & {
  unlocked: boolean;
  progressText: string;
};

export type GamificationSnapshot = {
  totalAttempts: number;
  uniqueCases: number;
  avgScore: number;
  level: LevelName;
  streakDays: number;
  longestStreakDays: number;
  masteredSkills: string[];
  badges: BadgeProgress[];
  unlockedBadgeIds: BadgeId[];
};

type LevelRule = {
  level: LevelName;
  minUniqueCases: number;
};

// Уровни привязаны к уникальным кейсам из 40
const LEVELS: LevelRule[] = [
  { level: 'Новичок',    minUniqueCases: 0  },  // 0 кейсов
  { level: 'Любитель',  minUniqueCases: 1  },  // 1–4 кейса
  { level: 'Практик',   minUniqueCases: 5  },  // 5–9 кейсов
  { level: 'Специалист',minUniqueCases: 10 },  // 10–19 кейсов
  { level: 'Эксперт',   minUniqueCases: 20 },  // 20–29 кейсов
  { level: 'Мастер',    minUniqueCases: 30 },  // 30–40 кейсов
];

const BADGES: BadgeMeta[] = [
  {
    id: 'first_case',
    icon: '🎯',
    title: 'Первый шаг',
    description: 'Решить первый кейс',
  },
  {
    id: 'streak_runner',
    icon: '🔥',
    title: 'Серия x3/x7',
    description: 'Проходить кейсы 3 и 7 дней подряд',
  },
  {
    id: 'perfectionist',
    icon: '⭐',
    title: 'Перфекционист',
    description: 'Держать средний балл 4.5+',
  },
  {
    id: 'experienced',
    icon: '🏅',
    title: 'Опытный / Эксперт',
    description: 'Решить 10 и 20 разных кейсов',
  },
  {
    id: 'master_topic',
    icon: '🏆',
    title: 'Мастер темы',
    description: 'Пройти все кейсы хотя бы одной категории',
  },
];

function normalizeDayKey(ts: number): string {
  const d = new Date(ts);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function dayDiff(a: string, b: string): number {
  const aDate = new Date(`${a}T00:00:00`);
  const bDate = new Date(`${b}T00:00:00`);
  return Math.round((bDate.getTime() - aDate.getTime()) / (1000 * 60 * 60 * 24));
}

function getLongestStreak(entries: AttemptEntry[]): number {
  if (entries.length === 0) return 0;
  const uniqueDays = Array.from(
    new Set(entries.map((entry) => normalizeDayKey(entry.ts)))
  ).sort();

  let longest = 1;
  let current = 1;
  for (let i = 1; i < uniqueDays.length; i += 1) {
    const diff = dayDiff(uniqueDays[i - 1], uniqueDays[i]);
    if (diff === 1) {
      current += 1;
      longest = Math.max(longest, current);
    } else if (diff > 1) {
      current = 1;
    }
  }

  return longest;
}

function getCurrentStreak(entries: AttemptEntry[]): number {
  if (entries.length === 0) return 0;
  const uniqueDays = Array.from(
    new Set(entries.map((entry) => normalizeDayKey(entry.ts)))
  ).sort();
  if (uniqueDays.length === 0) return 0;

  let streak = 1;
  for (let i = uniqueDays.length - 1; i > 0; i -= 1) {
    const diff = dayDiff(uniqueDays[i - 1], uniqueDays[i]);
    if (diff === 1) {
      streak += 1;
      continue;
    }
    break;
  }
  return streak;
}

function getLevel(uniqueCasesCount: number): LevelName {
  let current = LEVELS[0].level;
  for (const rule of LEVELS) {
    if (uniqueCasesCount >= rule.minUniqueCases) {
      current = rule.level;
    }
  }
  return current;
}

function getMasteredSkills(uniqueCaseIds: Set<number>) {
  const solvedBySkill = new Map<string, Set<number>>();
  const totalBySkill = new Map<string, Set<number>>();

  for (const c of cases) {
    for (const skill of c.skillFocus) {
      if (!totalBySkill.has(skill)) totalBySkill.set(skill, new Set<number>());
      totalBySkill.get(skill)!.add(c.id);

      if (uniqueCaseIds.has(c.id)) {
        if (!solvedBySkill.has(skill)) solvedBySkill.set(skill, new Set<number>());
        solvedBySkill.get(skill)!.add(c.id);
      }
    }
  }

  return Array.from(totalBySkill.entries())
    .filter(([skill, allCases]) => {
      const solvedCases = solvedBySkill.get(skill);
      return solvedCases && solvedCases.size > 0 && solvedCases.size === allCases.size;
    })
    .map(([skill]) => skill)
    .sort();
}

export function getBadgeMeta(id: BadgeId): BadgeMeta {
  const found = BADGES.find((b) => b.id === id);
  if (!found) {
    throw new Error(`Unknown badge id: ${id}`);
  }
  return found;
}

export function getAllBadgeMeta(): BadgeMeta[] {
  return BADGES;
}

export function buildGamification(attempts: AttemptEntry[]): GamificationSnapshot {
  const totalAttempts = attempts.length;
  // Считаем avgScore только по попыткам с ненулевым баллом,
  // чтобы старые/битые записи не занижали средний показатель
  const scoredAttempts = attempts.filter((e) => e.avgScore > 0);
  const avgScore =
    scoredAttempts.length > 0
      ? scoredAttempts.reduce((sum, entry) => sum + entry.avgScore, 0) / scoredAttempts.length
      : 0;
  const uniqueCaseIds = new Set(attempts.map((entry) => entry.caseId));
  const uniqueCases = uniqueCaseIds.size;
  const level = getLevel(uniqueCases);

  const longestStreakDays = getLongestStreak(attempts);
  const streakDays = getCurrentStreak(attempts);
  const masteredSkills = getMasteredSkills(uniqueCaseIds);

  const badges: BadgeProgress[] = BADGES.map((badge) => {
    if (badge.id === 'first_case') {
      return {
        ...badge,
        unlocked: totalAttempts >= 1,
        progressText: `${Math.min(totalAttempts, 1)}/1`,
      };
    }

    if (badge.id === 'streak_runner') {
      return {
        ...badge,
        unlocked: longestStreakDays >= 3,
        progressText: `${Math.min(longestStreakDays, 7)}/7 дней`,
      };
    }

    if (badge.id === 'perfectionist') {
      return {
        ...badge,
        unlocked: totalAttempts >= 3 && avgScore >= 4.5,
        progressText: `${avgScore.toFixed(1)}/4.5`,
      };
    }

    if (badge.id === 'experienced') {
      return {
        ...badge,
        unlocked: uniqueCases >= 10,
        progressText: `${Math.min(uniqueCases, 20)}/20 кейсов`,
      };
    }

    return {
      ...badge,
      unlocked: masteredSkills.length > 0,
      progressText:
        masteredSkills.length > 0
          ? `Освоено: ${masteredSkills.length}`
          : 'Освоено: 0',
    };
  });

  return {
    totalAttempts,
    uniqueCases,
    avgScore,
    level,
    streakDays,
    longestStreakDays,
    masteredSkills,
    badges,
    unlockedBadgeIds: badges.filter((b) => b.unlocked).map((b) => b.id),
  };
}
