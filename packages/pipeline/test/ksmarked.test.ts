import { describe, expect, it } from 'vitest';
import { parseKsMarked } from '../src/adapters/ksmarked.ts';

// Trimmed from the real ksmarked.dk homepage: one DETAILED card (full venue +
// address + weekend range) and one calendar pair with a partial address, plus a
// bare MARKEDSKALENDER list carrying two further towns with dates only.
const HTML = `
<div class="cards">
  <h3>Rønde</h3><span>3 oktober, 2026</span><span>-</span><span>4 oktober, 2026</span>
  <p>Rønde Idrætscenter</p><p>Skrejrupvej 9B, 8410 Rønde</p>
  <a>For besøgende</a><a>Bliv udstiller</a>
  <h3>Haderslev</h3><span>17 oktober, 2026</span><span>-</span><span>18 oktober, 2026</span>
  <p>Haderslev Idrætscenter</p><p>Stadionvej 5</p>
  <a>For besøgende</a><a>Bliv udstiller</a>
</div>
<div class="Markedskalender">Markedskalender
  <div>Rønde</div><div>3 oktober, 2026</div>
  <div>Aars</div><div>9 januar, 2027</div>
  <div>Svendborg 2027</div><div>13 februar, 2027</div>
</div>`;

describe('parseKsMarked', () => {
  const events = parseKsMarked(HTML);
  const byCity = (c: string) => events.find((e) => e.city === c);

  it('parses a detailed card with venue, street, postcode and a weekend range', () => {
    const roende = byCity('Rønde')!;
    expect(roende).toMatchObject({
      sourceKey: 'ksmarked',
      title: 'Loppemarked Rønde',
      venueName: 'Rønde Idrætscenter',
      street: 'Skrejrupvej 9B',
      postcode: '8410',
      city: 'Rønde',
      indoorOutdoor: 'indoor',
    });
    expect(roende.occurrences!.map((o) => o.date)).toEqual(['2026-10-03', '2026-10-04']);
  });

  it('keeps a partial address (street, no postcode) without inventing one', () => {
    const hs = byCity('Haderslev')!;
    expect(hs.street).toBe('Stadionvej 5');
    expect(hs.postcode).toBeUndefined();
    expect(hs.venueName).toBe('Haderslev Idrætscenter');
  });

  it('captures calendar-only towns at town precision (city set, single date)', () => {
    const aars = byCity('Aars')!;
    expect(aars.street).toBeUndefined();
    expect(aars.venueName).toBeUndefined();
    expect(aars.occurrences!.map((o) => o.date)).toEqual(['2027-01-09']);
  });

  it('strips the disambiguating year from a "Svendborg 2027" town label', () => {
    const sv = byCity('Svendborg')!;
    expect(sv.title).toBe('Loppemarked Svendborg');
    expect(sv.occurrences![0]!.date).toBe('2027-02-13');
  });

  it('does not duplicate a market present in both the card and the calendar', () => {
    expect(events.filter((e) => e.city === 'Rønde')).toHaveLength(1);
  });
});
