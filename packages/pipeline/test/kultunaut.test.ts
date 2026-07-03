import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { kultunaut, looksLikeMarket, parseKultunautDate } from '../src/adapters/kultunaut.ts';

const fixture = (name: string) =>
  readFileSync(join(import.meta.dirname, 'fixtures', name), 'latin1');

describe('parseKultunautDate', () => {
  it('parses a single date with hours', () => {
    expect(parseKultunautDate('Fre. d. 3. juli 2026, kl. 10-16.')).toEqual([
      { date: '2026-07-03', startTime: '10:00', endTime: '16:00' },
    ]);
  });

  it('parses a range where the year is only on the last date', () => {
    expect(
      parseKultunautDate('Lør. d. 4. juli - søn. d. 5. juli 2026, kl. 10-15.'),
    ).toEqual([
      { date: '2026-07-04', startTime: '10:00', endTime: '15:00' },
      { date: '2026-07-05', startTime: '10:00', endTime: '15:00' },
    ]);
  });

  it('parses times with minutes', () => {
    expect(parseKultunautDate('Tor. d. 2. juli 2026, kl. 09-14.30.')).toEqual([
      { date: '2026-07-02', startTime: '09:00', endTime: '14:30' },
    ]);
  });

  it('returns nothing for undated text', () => {
    expect(parseKultunautDate('Se hjemmesiden for datoer')).toEqual([]);
  });

  it('resolves a long "hver mandag" span to only Mondays, never a daily fill', () => {
    const occ = parseKultunautDate(
      'Man. d. 6. juli - man. d. 3. august 2026, kl. 10-16.',
      'Byen fyldes hver mandag i uge 27 til 34 med boder.',
    );
    expect(occ.map((o) => o.date)).toEqual([
      '2026-07-06',
      '2026-07-13',
      '2026-07-20',
      '2026-07-27',
      '2026-08-03',
    ]);
    expect(occ.every((o) => o.startTime === '10:00' && o.endTime === '16:00')).toBe(true);
  });

  it('does not daily-fill a long span with no weekday rule (keeps only stated dates)', () => {
    expect(
      parseKultunautDate('D. 2. juli - d. 7. august 2026, kl. 10-16.', 'Kom forbi hen over sommeren.'),
    ).toEqual([
      { date: '2026-07-02', startTime: '10:00', endTime: '16:00' },
      { date: '2026-08-07', startTime: '10:00', endTime: '16:00' },
    ]);
  });
});

describe('looksLikeMarket', () => {
  it('accepts events with market signals in title or description', () => {
    expect(looksLikeMarket('Lopper på Torvet i Gråsten')).toBe(true);
    expect(looksLikeMarket('Sommerfest', 'Stort kræmmermarked med 100 boder')).toBe(true);
    expect(looksLikeMarket('Byttedag', 'byttemarked for børnetøj')).toBe(true);
  });

  it('rejects non-market events that slip through the genre facet', () => {
    expect(looksLikeMarket('Efterfødselstræning på reformer', 'Kom i form efter fødslen')).toBe(false);
    expect(looksLikeMarket('Yoga i parken')).toBe(false);
    // "genbrug" as material (recycled wood) is not a market signal.
    expect(looksLikeMarket('Feriesjov på museet', 'byg små skibe af træ og genbrug')).toBe(false);
    expect(looksLikeMarket('Genbrugsmarked i sognegården')).toBe(true);
  });
});

describe('kultunaut adapter', () => {
  it('extracts a full event from a real page', () => {
    const raw = kultunaut.extract(
      'https://www.kultunaut.dk/perl/arrmore/type-nynaut?ArrNr=19422861',
      fixture('kultunaut-event.html'),
    );
    expect(raw).not.toBeNull();
    expect(raw!.title).toBe('Lopper på Torvet i Gråsten');
    expect(raw!.sourceEventId).toBe('19422861');
    expect(raw!.category).toBe('loppemarked');
    expect(raw!.venueName).toBe('Torvet');
    expect(raw!.city).toBe('Gråsten');
    expect(raw!.lat).toBeCloseTo(54.9216, 3);
    expect(raw!.lng).toBeCloseTo(9.59319, 3);
    expect(raw!.occurrences).toEqual([
      { date: '2026-07-03', startTime: '10:00', endTime: '16:00' },
    ]);
    expect(raw!.description).toContain('Kræftens Bekæmpelse');
  });

  it('finds ArrNrs on a listing page', () => {
    const html = fixture('kultunaut-list.html');
    const ids = new Set([...html.matchAll(/data-arrnr="(\d+)"/g)].map((m) => m[1]));
    expect(ids.size).toBe(12);
  });
});
