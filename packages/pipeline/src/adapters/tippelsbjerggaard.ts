/**
 * Tippelsbjerggaard Loppe-, Retro- & Antikmarked — Hornegydén 6, 5600 Faaborg
 * (Horne). A real recurring market a user flagged as wrongly missing.
 *
 * We couldn't crawl it live: its own Facebook poster is an OCR-hostile date table,
 * and its two listings (VisitFaaborg / GulogGratis) are JavaScript-rendered SPAs a
 * plain fetcher can't read. But Faaborg Turistbureau PUBLISHES the exact open days,
 * so we carry those verified dates here with that provenance rather than skip a
 * market we know is happening. Open the listed Saturdays kl. 10-16.
 *
 * REFRESH annually from the source URL below (dates are calendar-year specific).
 */
import type { EventCategory, Occurrence, RawEvent } from '@loppefund/core';
import type { FetchFn, SourceAdapter } from './types.ts';

const SOURCE =
  'https://www.visitfaaborg.dk/faaborg/planlaeg-din-tur/loppemarked-reolmarked-gdk1151805';

// Verified 2026 open days (Faaborg Turistbureau): the 1st/3rd (and one 5th)
// Saturday of Aug–Dec, kl. 10–16.
const OPEN_DAYS_2026: readonly string[] = [
  '2026-08-02', '2026-08-16', '2026-08-30',
  '2026-09-06', '2026-09-20',
  '2026-10-04', '2026-10-18',
  '2026-11-01', '2026-11-15',
  '2026-12-06', '2026-12-20',
];

/** Verified open days on/after `today`. Exported for testing without a clock. */
export function upcomingOpenDays(today: string): Occurrence[] {
  return OPEN_DAYS_2026.filter((d) => d >= today).map((date) => ({
    date,
    startTime: '10:00',
    endTime: '16:00',
  }));
}

export const tippelsbjerggaard: SourceAdapter = {
  key: 'tippelsbjerggaard',
  name: 'Tippelsbjerggaard (VisitFaaborg)',
  baseUrl: 'https://www.visitfaaborg.dk/',
  // Reliable tourism-bureau data, but hand-carried (not live-crawled) — so a
  // notch below a live first-party crawl.
  trust: 0.6,

  async discover(): Promise<string[]> {
    return [];
  },
  extract(): RawEvent | null {
    return null;
  },

  async fetchRawEvents(_fetch: FetchFn): Promise<RawEvent[]> {
    const today = new Date().toISOString().slice(0, 10);
    const occurrences = upcomingOpenDays(today);
    if (occurrences.length === 0) return [];
    return [
      {
        sourceKey: 'tippelsbjerggaard',
        sourceUrl: SOURCE,
        sourceEventId: 'tippelsbjerggaard-faaborg',
        title: 'Tippelsbjerggaard Loppe-, Retro- & Antikmarked',
        description:
          'Marked med mange forskellige kræmmerstande på Tippelsbjerggaard i Horne ved Faaborg. Åbent udvalgte lørdage kl. 10–16. Kilde: Faaborg Turistbureau (VisitFaaborg).',
        category: 'kraemmermarked' as EventCategory,
        venueName: 'Tippelsbjerggaard',
        street: 'Hornegydén 6',
        postcode: '5600',
        city: 'Faaborg',
        indoorOutdoor: 'indoor',
        organizer: 'Tippelsbjerggaard',
        contactWebsite: SOURCE,
        occurrences,
      },
    ];
  },
};
