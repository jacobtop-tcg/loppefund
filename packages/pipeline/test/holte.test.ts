import { describe, expect, it } from 'vitest';
import { parseHolte } from '../src/adapters/holte.ts';

// The real season sentence from holte-loppemarked.dk (entity-encoded as served).
const HTML = `<h1>HOLTE LOPPEMARKED 2026</h1>
  <p>S&oslash;ndage fra 12. april til 11. oktober (dog ikke d. 16. august).</p>
  <p>Tlf: +45 22200544</p>`;

describe('parseHolte', () => {
  const raw = parseHolte(HTML, '2026-01-01')!;

  it('emits the single recurring market with phone and city', () => {
    expect(raw).toMatchObject({
      sourceKey: 'holte',
      title: 'Holte Loppemarked',
      city: 'Holte',
      indoorOutdoor: 'outdoor',
      contactPhone: '+45 22200544',
    });
  });

  it('expands every Sunday in season as a concrete date', () => {
    const dates = raw.occurrences!.map((o) => o.date);
    expect(dates[0]).toBe('2026-04-12'); // first Sunday of the season
    expect(dates.at(-1)).toBe('2026-10-11'); // last
    // Every emitted date is a Sunday.
    expect(dates.every((d) => new Date(`${d}T00:00:00Z`).getUTCDay() === 0)).toBe(true);
  });

  it('removes the parenthetical "dog ikke 16. august" skip date', () => {
    expect(raw.occurrences!.map((o) => o.date)).not.toContain('2026-08-16');
  });

  it('returns null when no season sentence is present', () => {
    expect(parseHolte('<p>Velkommen til markedet</p>', '2026-01-01')).toBeNull();
  });
});
