import { describe, expect, it } from 'vitest';
import { productToRawEvent } from '../src/adapters/loppebjornen.ts';

const market = (over: Record<string, unknown>) => ({
  id: 1,
  name: 'X',
  permalink: 'https://loppebjornen.dk/vare/x/',
  short_description: '',
  categories: [{ name: 'Loppemarked' }],
  ...over,
});

describe('loppebjornen productToRawEvent', () => {
  it('parses a standard market product (date + location after the slash)', () => {
    const raw = productToRawEvent(
      market({
        id: 5293,
        name: 'Ballerup Loppemarked 2 august 2026',
        short_description:
          '<p>Afholdes Søndag d. 02 august 2026</p>\n<p>Lokation:  Ballerup Loppemarked V. Ballerup Rådhus på parkerings arealet. / Hold-an vej 7, 2750 Ballerup</p>\n<p>Antal stande: 150</p>\n<p>Priser: 135kr pr stand.</p>',
      }),
    );
    expect(raw).not.toBeNull();
    expect(raw!.sourceKey).toBe('loppebjornen');
    expect(raw!.sourceEventId).toBe('5293');
    expect(raw!.title).toBe('Ballerup Loppemarked');
    expect(raw!.category).toBe('loppemarked');
    expect(raw!.street).toBe('Hold-an vej 7');
    expect(raw!.postcode).toBe('2750');
    expect(raw!.city).toBe('Ballerup');
    expect(raw!.occurrences).toEqual([{ date: '2026-08-02', startTime: null, endTime: null }]);
  });

  it('reads the date from free text without a "d." and dedupes repeats', () => {
    const raw = productToRawEvent(
      market({
        id: 5032,
        name: 'KBH Længste loppemarked 29 august 2026',
        short_description:
          '<p>KØBENHAVNS LÆNGSTE LOPPEMARKED  29 august 2026</p>\n<p>Lokation: Ørestads boulevard 37-75, og Kay fiskers Plads 1, 2300 KBH S.</p>\n<p>Dato og tid:</p>\n<p>d 29 august 2026</p>\n<p>kl. 10.00-16.00</p>',
      }),
    );
    expect(raw).not.toBeNull();
    expect(raw!.title).toBe('KBH Længste loppemarked');
    expect(raw!.occurrences).toEqual([{ date: '2026-08-29', startTime: null, endTime: null }]);
    expect(raw!.postcode).toBe('2300');
  });

  it('strips a dash-separated date from the title', () => {
    const raw = productToRawEvent(
      market({
        id: 5048,
        name: 'Ørestad Loppemarked &#8211; 1 august 2026',
        short_description:
          '<p>Afholdes Lørdag d. 1 august 2026</p>\n<p>Lokation:  Ørestads boulevard 66, 2300 KBH S.</p>',
      }),
    );
    expect(raw!.title).toBe('Ørestad Loppemarked');
    expect(raw!.occurrences![0]!.date).toBe('2026-08-01');
    expect(raw!.street).toBe('Ørestads boulevard 66');
  });

  it('ignores non-market products (tables, chairs)', () => {
    expect(
      productToRawEvent(market({ name: 'Borde Ballerup 2 august', categories: [{ name: 'Borde' }] })),
    ).toBeNull();
  });

  it('returns null when no date can be parsed', () => {
    expect(
      productToRawEvent(market({ name: 'Ørestad Loppemarked', short_description: '<p>Kommer snart</p>' })),
    ).toBeNull();
  });
});
