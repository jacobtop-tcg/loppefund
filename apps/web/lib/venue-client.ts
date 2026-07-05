import { osmOpenState, type OpenState } from '@loppefund/core';

export const VENUE_TYPES = ['genbrug', 'antik', 'loppebutik', 'reolmarked'] as const;
export type VenueType = (typeof VENUE_TYPES)[number];

export const VENUE_LABELS: Record<string, string> = {
  genbrug: 'Genbrug',
  antik: 'Antik & antikvariat',
  loppebutik: 'Loppebutik',
  reolmarked: 'Reolmarked',
};

/** Short label for a compact chip/stub. */
export const VENUE_SHORT: Record<string, string> = {
  genbrug: 'Genbrug',
  antik: 'Antik',
  loppebutik: 'Loppe',
  reolmarked: 'Reol',
};

function isoWeekdayMon0(isoDate: string): number {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return (dow + 6) % 7; // 0 = Monday
}

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return h * 60 + m;
}

/** Live open/closed state for a venue against the visitor's Copenhagen clock. */
export function venueOpenState(
  hoursText: string | null | undefined,
  now: { date: string; time: string },
): OpenState {
  return osmOpenState(hoursText, isoWeekdayMon0(now.date), minutesOf(now.time));
}

const DK_WEEKDAYS_LONG = ['mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag', 'søndag'];

/** A human "Åbent nu …" / "Åbner … kl. X" phrase, or null when hours are unknown. */
export function openLabel(
  state: OpenState,
  now: { date: string; time: string },
): { text: string; open: boolean } | null {
  if (!state.known) return null;
  if (state.open) {
    // A range that runs to midnight (24:00) is effectively "open all day" — the
    // close time is noise, so drop it.
    const showClose = state.closesAt && state.closesAt !== '24:00';
    return { text: showClose ? `Åbent nu · lukker ${state.closesAt}` : 'Åbent nu', open: true };
  }
  if (state.opensAt == null) return { text: 'Lukket', open: false };
  if (state.opensInDays === 0) return { text: `Lukket · åbner kl. ${state.opensAt}`, open: false };
  if (state.opensInDays === 1) return { text: `Åbner i morgen kl. ${state.opensAt}`, open: false };
  const target = (isoWeekdayMon0(now.date) + (state.opensInDays ?? 0)) % 7;
  return { text: `Åbner ${DK_WEEKDAYS_LONG[target]} kl. ${state.opensAt}`, open: false };
}
