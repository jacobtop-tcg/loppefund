import { describe, expect, it } from 'vitest';
import { parseTip, scanDates } from '../src/tip-parser.ts';

const REF = '2026-07-02';

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
