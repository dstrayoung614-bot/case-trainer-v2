export type EventName =
  | 'landing_viewed'
  | 'case_browser_opened'
  | 'case_selected'
  | 'writing_started'
  | 'analyze_clicked'
  | 'feedback_received'
  | 'feedback_useful'
  | 'feedback_not_useful'
  | 'retry_started'
  | 'upgrade_clicked'
  | 'upgrade_received'
  | 'next_case_clicked';

export type TrackEvent = {
  event: EventName;
  timestamp: string;
  caseId?: number;
  caseTitle?: string;
  attemptNumber?: number;
  avgScore?: number;
  meta?: Record<string, unknown>;
};

const STORAGE_KEY = 'ct_events';
const MAX_EVENTS = 200;

export function track(
  event: EventName,
  meta?: Omit<TrackEvent, 'event' | 'timestamp'>
) {
  const entry: TrackEvent = {
    event,
    timestamp: new Date().toISOString(),
    ...meta,
  };

  if (typeof window === 'undefined') return;

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const events: TrackEvent[] = raw ? JSON.parse(raw) : [];
    events.push(entry);
    // keep last MAX_EVENTS to avoid unbounded growth
    if (events.length > MAX_EVENTS) events.splice(0, events.length - MAX_EVENTS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
  } catch {
    // silently fail — never block the user
  }

  // also log to console during development
  console.log('[CaseTrainer]', entry.event, meta ?? '');
}

export function getEvents(): TrackEvent[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}
