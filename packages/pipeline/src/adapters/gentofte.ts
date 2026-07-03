/**
 * Adapter for gentofteloppemarked.dk — Gentofte Loppemarked, a single market
 * held every Sunday 8–14 through a spring–autumn season ("12. april – 4.
 * oktober") next to Charlottenlund Station. Charity-run by Herberget
 * Overførstergården. Wix site: no schema.org Event or API, but the schedule,
 * season and address are server-rendered in the static HTML.
 *
 * Dedicated single-market source, trust 0.7. robots.txt allows all but
 * `*?lightbox=`. The season is stated WITHOUT a year, so the concrete Sundays
 * are computed for the current/next season on each crawl — expressing the
 * season as a resolver dateRange would wrongly yield an occurrence every day.
 */
import { parse } from 'node-html-parser';
import { addDays, WEEKDAYS, weekdayOf, type Occurrence, type RawEvent } from '@loppefund/core';
import type { SourceAdapter } from './types.ts';

const BASE = 'https://gentofteloppemarked.dk';

const MONTHS: Record<string, number> = {
  januar: 1, februar: 2, marts: 3, april: 4, maj: 5, juni: 6,
  juli: 7, august: 8, september: 9, oktober: 10, november: 11, december: 12,
};
const MONTH_NAMES = Object.keys(MONTHS).join('|');

function iso(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Concrete `weekday` dates inside a yearless season, for whichever run of the
 * season is current or next relative to `today`. Past dates are omitted; the
 * canonical layer only shows future occurrences anyway.
 */
export function seasonOccurrences(opts: {
  weekday: number; // 1=Mon..7=Sun
  startMonth: number;
  startDay: number;
  endMonth: number;
  endDay: number;
  startTime: string | null;
  endTime: string | null;
  today: string;
}): Occurrence[] {
  let year = Number(opts.today.slice(0, 4));
  // If this year's season has already ended, target next year's season.
  if (iso(year, opts.endMonth, opts.endDay) < opts.today) year++;
  const seasonStart = iso(year, opts.startMonth, opts.startDay);
  const seasonEnd = iso(year, opts.endMonth, opts.endDay);
  const from = seasonStart < opts.today ? opts.today : seasonStart;

  const out: Occurrence[] = [];
  let d = from;
  for (let i = 0; d <= seasonEnd && i < 400; i++, d = addDays(d, 1)) {
    if (weekdayOf(d) === opts.weekday) {
      out.push({ date: d, startTime: opts.startTime, endTime: opts.endTime });
    }
  }
  return out;
}

export const gentofte: SourceAdapter = {
  key: 'gentofte',
  name: 'Gentofte Loppemarked',
  baseUrl: BASE,
  trust: 0.7,

  async discover(): Promise<string[]> {
    return [`${BASE}/`];
  },

  extract(url: string, html: string): RawEvent | null {
    const root = parse(html);
    root.querySelectorAll('script, style').forEach((n) => n.remove());
    const text = root.text.replace(/\s+/g, ' ').trim();

    // "ÅBENT HVER SØNDAG 8 -14" — the recurring weekday and opening hours.
    // This block is the liveness anchor: no schedule, no event.
    const sched = text.match(
      new RegExp(`hver\\s+(${Object.keys(WEEKDAYS).join('|')})e?\\s+(\\d{1,2})\\s*[-–]\\s*(\\d{1,2})`, 'i'),
    );
    // "12. APRIL - 4. OKTOBER" — the season, stated without a year. Matched
    // against explicit month names so a missing space ("OKTOBERDU") can't
    // swallow the following word.
    const season = text.match(
      new RegExp(
        `(\\d{1,2})\\.?\\s*(${MONTH_NAMES})\\s*[-–]\\s*(\\d{1,2})\\.?\\s*(${MONTH_NAMES})`,
        'i',
      ),
    );
    if (!sched || !season) return null;

    const weekday = WEEKDAYS[sched[1]!.toLowerCase()]!;
    const startHour = Number(sched[2]);
    const endHour = Number(sched[3]);
    const occurrences = seasonOccurrences({
      weekday,
      startDay: Number(season[1]),
      startMonth: MONTHS[season[2]!.toLowerCase()]!,
      endDay: Number(season[3]),
      endMonth: MONTHS[season[4]!.toLowerCase()]!,
      startTime: `${String(startHour).padStart(2, '0')}:00`,
      endTime: `${String(endHour).padStart(2, '0')}:00`,
      today: new Date().toISOString().slice(0, 10),
    });
    if (occurrences.length === 0) return null;

    const street = text.match(/finder du på\s+([^,]+?),/i)?.[1]?.trim();
    const city = text.match(/([A-ZÆØÅ][a-zæøåA-ZÆØÅ]+)\s+Station/)?.[1];
    const organizer = text.match(/drives af\s+([^.,]+?),/i)?.[1]?.trim();
    const contactEmail = text.match(/[\w.\-]+@[\w.\-]+\.\w+/)?.[0];
    const title =
      text.match(/([A-ZÆØÅ][\wæøåÆØÅ]*\s+Loppemarked)\s+finder du/i)?.[1]?.trim() ||
      'Gentofte Loppemarked';

    return {
      sourceKey: 'gentofte',
      sourceUrl: url,
      sourceEventId: 'gentofte-loppemarked',
      title,
      category: 'loppemarked',
      street,
      city,
      organizer,
      contactEmail,
      contactWebsite: `${BASE}/`,
      openingHoursText: `${sched[1]} ${startHour}-${endHour}`,
      occurrences,
    };
  },
};
