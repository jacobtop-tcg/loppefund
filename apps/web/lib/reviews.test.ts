import { describe, expect, it } from 'vitest';
import { starGlyphs, summarizeReviews } from './reviews.ts';

describe('summarizeReviews', () => {
  it('averages, rounds to one decimal, and sorts newest first', () => {
    const s = summarizeReviews([
      { rating: 5, text: 'Super', author: 'Mette', date: '2026-06-01' },
      { rating: 4, text: null, author: null, date: '2026-07-01' },
    ]);
    expect(s.count).toBe(2);
    expect(s.average).toBe(4.5);
    expect(s.reviews[0]!.date).toBe('2026-07-01'); // newest first
  });

  it('drops malformed or out-of-range entries', () => {
    const s = summarizeReviews([
      { rating: 5, date: '2026-06-01' },
      { rating: 0 },
      { rating: 9 },
      { text: 'no rating' },
      null,
      'nonsense',
    ]);
    expect(s.count).toBe(1);
    expect(s.average).toBe(5);
  });

  it('returns an empty summary for no/garbage input', () => {
    expect(summarizeReviews(undefined)).toEqual({ count: 0, average: 0, reviews: [] });
    expect(summarizeReviews('x')).toEqual({ count: 0, average: 0, reviews: [] });
  });

  it('blanks empty text/author to null and rounds fractional ratings', () => {
    const s = summarizeReviews([{ rating: 4, text: '   ', author: '', date: '2026-01-01' }]);
    expect(s.reviews[0]).toEqual({ rating: 4, text: null, author: null, date: '2026-01-01' });
  });
});

describe('starGlyphs', () => {
  it('renders full/empty stars for a rounded mean', () => {
    expect(starGlyphs(5)).toBe('★★★★★');
    expect(starGlyphs(4.2)).toBe('★★★★☆');
    expect(starGlyphs(0)).toBe('☆☆☆☆☆');
  });
});
