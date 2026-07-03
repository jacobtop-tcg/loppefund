import { describe, expect, it } from 'vitest';
import { parseTip, scanDates, extractTitle } from '../src/tip-parser.ts';

const REF = '2026-07-02';

describe('extractTitle', () => {
  it('cuts a run-on Facebook post at the date/time so the title is the name', () => {
    expect(
      extractTitle('Loppemarked ved Dyreborg lørdag den 5. juli kl. 10-15. Kom og gør et godt fund!'),
    ).toBe('Loppemarked ved Dyreborg');
    expect(extractTitle('Månedligt loppemarked i Stenstrup søndag d. 13/7 fra 10 til 16')).toBe(
      'Månedligt loppemarked i Stenstrup',
    );
    expect(extractTitle('Kræmmermarked i Horne 5/7 kl. 9-14')).toBe('Kræmmermarked i Horne');
  });

  it('leaves an already-clean title untouched', () => {
    expect(extractTitle('STORT LOPPEMARKED I SKOVLUNDE 🌞')).toBe('STORT LOPPEMARKED I SKOVLUNDE 🌞');
    expect(extractTitle('Gammel Strand Antikmarked')).toBe('Gammel Strand Antikmarked');
  });

  it('does not cut a weekday embedded in a word', () => {
    expect(extractTitle('Lørdagsloppemarked i Valby')).toBe('Lørdagsloppemarked i Valby');
  });

  it('keeps the original line when a cut would leave almost nothing', () => {
    expect(extractTitle('Den 5. juli holder vi loppemarked')).toBe('Den 5. juli holder vi loppemarked');
  });
});

describe('scanDates', () => {
  it('parses full Danish dates', () => {
    expect(scanDates('lørdag den 11. juli 2026 kl. 10-15', REF)).toEqual(['2026-07-11']);
    expect(scanDates('11-07-2026', REF)).toEqual(['2026-07-11']);
  });

  it('resolves year-less dates to the next occurrence', () => {
    expect(scanDates('Lørdag d. 11/7 kl. 10-15', REF)).toEqual(['2026-07-11']);
    expect(scanDates('vi ses den 11. juli!', REF)).toEqual(['2026-07-11']);
    // A date already passed this year rolls to next year.
    expect(scanDates('den 3/5 holder vi marked', REF)).toEqual(['2027-05-03']);
  });

  it('collects multiple dates', () => {
    expect(scanDates('marked både 11/7 og 12/7', REF)).toEqual(['2026-07-11', '2026-07-12']);
  });

  it('ignores clock times and fractions', () => {
    // "10-15" is a time range, "1/2" could be a fraction — the d/m regex
    // still reads 1/2 as 1. februar; acceptable for a draft that a human
    // reviews, but times must not become dates.
    expect(scanDates('kl. 10-15', REF)).toEqual([]);
  });

  it('parses dot-separated dates with a Danish date marker', () => {
    // The common Facebook-poster form "d. 4.7" / "den 4.7".
    expect(scanDates('Loppemarked lørdag d. 4.7 kl. 10-14', REF)).toEqual(['2026-07-04']);
    expect(scanDates('Vi holder marked den 12.7', REF)).toEqual(['2026-07-12']);
    expect(scanDates('d. 4.7.2026 kl. 10', REF)).toEqual(['2026-07-04']);
  });

  it('does not misread a clock time as a dot-separated date', () => {
    // "kl. 10.12" is 10:12, not the 10th of December — no date marker, so it
    // must not become a date (incorrect dates are the cardinal sin).
    expect(scanDates('Åbent kl. 10.12 hver dag', REF)).toEqual([]);
    expect(scanDates('lørdag 10.12', REF)).toEqual([]); // bare, no "d."/"den" marker
  });
});

describe('parseTip', () => {
  it('turns a typical Facebook post into a draft RawEvent', () => {
    const raw = parseTip(
      {
        id: 7,
        url: 'https://www.facebook.com/events/123',
        text: 'STORT LOPPEMARKED I SKOVLUNDE 🌞\nLørdag d. 11/7 kl. 10-15 på Byvej 12, 2740 Skovlunde.\nGratis entré, kaffe og kage. Alle er velkomne!',
      },
      REF,
    );
    expect(raw).not.toBeNull();
    expect(raw!.sourceKey).toBe('tip');
    expect(raw!.sourceEventId).toBe('tip-7');
    expect(raw!.title).toBe('STORT LOPPEMARKED I SKOVLUNDE 🌞');
    expect(raw!.category).toBe('loppemarked');
    expect(raw!.occurrences).toEqual([
      { date: '2026-07-11', startTime: '10:00', endTime: '15:00' },
    ]);
    expect(raw!.street).toBe('Byvej 12');
    expect(raw!.postcode).toBe('2740');
    expect(raw!.city).toBe('Skovlunde');
  });

  it('extracts a clean street from a multi-line OCR\'d poster', () => {
    // Real "Loppemarked Sydfyn" poster text (via Vision OCR). The street must
    // not span the line break and swallow "…Apotek." from the line above.
    const raw = parseTip(
      {
        id: 'ocr',
        url: null,
        text:
          'LOPPEMARKED\nlørdag d. 4.7 kl. 10-14\ni gården bag Sankt Nicolai Apotek.\n' +
          'Sankt Nicolai Gade 2a, lige over for kirken.\nBlandede ting til hjemmet, tøj, små møbler etc.',
      },
      REF,
    );
    expect(raw).not.toBeNull();
    expect(raw!.street).toBe('Sankt Nicolai Gade 2a');
    expect((raw!.occurrences ?? []).map((o) => o.date)).toContain('2026-07-04');
  });

  it('resolves a recurring poster bounded to a named month', () => {
    // Real "Loppemarked Sydfyn" poster: recurring, no single date, but a month.
    const raw = parseTip(
      {
        id: 'humble',
        url: null,
        text: 'Sommermarked i Humble\nHver lørdag fra kl. 10.00-15.00 i juli måned\nHovedgaden 51, 5932 Humble',
      },
      REF,
    );
    expect(raw).not.toBeNull();
    // Saturdays in July 2026 on/after REF (2026-07-02): 4, 11, 18, 25.
    expect((raw!.occurrences ?? []).map((o) => o.date)).toEqual([
      '2026-07-04',
      '2026-07-11',
      '2026-07-18',
      '2026-07-25',
    ]);
  });

  it('does not invent dates from a month mention without a recurring phrase', () => {
    // "loppemarked i juli" alone must NOT become every day / every Saturday.
    expect(parseTip({ id: 2, url: null, text: 'Stort loppemarked i juli i Humble' }, REF)).toBeNull();
  });

  it('rejects tips without a resolvable date', () => {
    expect(
      parseTip({ id: 1, url: null, text: 'Kom til loppemarked snart i Valby!' }, REF),
    ).toBeNull();
  });

  it('leaves URL-only tips for human processing', () => {
    expect(
      parseTip({ id: 2, url: 'https://facebook.com/events/9', text: null }, REF),
    ).toBeNull();
  });
});
