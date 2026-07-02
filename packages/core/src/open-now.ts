/**
 * "Open right now" predicate. Pure and isomorphic — safe for client bundles.
 */
import type { Occurrence } from './types.ts';

/**
 * True when some occurrence on `date` has known times and
 * startTime <= time <= endTime (inclusive). Null times never match;
 * endTime < startTime (overnight/bad data) is conservatively excluded.
 * Times are zero-padded "HH:MM", so lexicographic comparison is correct;
 * "24:00" sorts after "23:59" and works as an end bound.
 */
export function isOpenAt(
  occurrences: ReadonlyArray<Pick<Occurrence, 'date' | 'startTime' | 'endTime'>>,
  date: string,
  time: string,
): boolean {
  return occurrences.some(
    (o) =>
      o.date === date &&
      o.startTime !== null &&
      o.endTime !== null &&
      o.endTime >= o.startTime &&
      o.startTime <= time &&
      time <= o.endTime,
  );
}

export interface CphNow {
  date: string;
  time: string;
}

/** Current wall-clock date+time in Europe/Copenhagen, e.g. { date: '2026-07-02', time: '14:31' }. */
export function copenhagenNow(at: Date = new Date()): CphNow {
  const s = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Copenhagen',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(at);
  const [date, time] = s.split(' ') as [string, string];
  return { date, time };
}
