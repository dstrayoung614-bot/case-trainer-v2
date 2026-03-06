export type Difficulty = 'easy' | 'medium' | 'hard';

export type Case = {
  id: number;
  title: string;
  description: string;
  difficulty: Difficulty;
  skillFocus: string[];
  estimatedMinutes: number;
  expectedFocus: string;
  exampleSolution?: string;
};

export type SolutionSections = {
  framing: string;
  hypotheses: string;
  metrics: string;
  actions: string;
  risks: string;
};

export type SelfReview = {
  confidence: 1 | 2 | 3 | 4 | 5;
  uncertainArea: string;
};

export type RubricScores = {
  problemFraming: number;
  diagnosis: number;
  metricsThinking: number;
  prioritization: number;
  clarityStructure: number;
  tradeOffs: number;
};

export type Issue = {
  dimension: string;
  issue: string;
  whyItMatters: string;
};

export type FeedbackResponse = {
  scores: RubricScores;
  strengths: string[];
  issues: Issue[];
  topFixes: string[];
  nextIterationPrompt: string;
  disclaimer: string;
  isMock?: boolean;
};

export type AnalyzeRequest = {
  caseId: number;
  caseTitle: string;
  caseDescription: string;
  difficulty: Difficulty;
  skillFocus: string[];
  solution: string;
  selfReview: SelfReview;
  rubricVersion: string;
  apiKey: string;
  model: string;
};

export type UpgradeChange = {
  section: string;
  original: string;
  improved: string;
  explanation: string;
};

export type UpgradeResponse = {
  upgradedSolution: string;
  weaknesses: string[];
  improvementExplanation: string;
  changes: UpgradeChange[];
  coachingQuestions: string[];
  nextIterationTask: string;
  keyLessons: string[];
  isMock?: boolean;
};

export type UpgradeRequest = {
  caseId: number;
  caseTitle: string;
  caseDescription: string;
  difficulty: Difficulty;
  skillFocus: string[];
  originalSolution: string;
  feedback: FeedbackResponse;
  apiKey: string;
  model: string;
};

export type AppScreen =
  | 'landing'
  | 'case-browser'
  | 'case'
  | 'self-review'
  | 'feedback'
  | 'upgrade';
