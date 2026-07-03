// Community reviews, aggregated for one market. Reviews are a CURATED bridge,
// not auto-published: a visitor submits via ReviewForm (same zero-backend path
// as tips/confirmations), the operator vets it, and only then does it land in
// data/reviews.json committed to the repo — so the "extremely high data quality"
// bar the mission sets for community input is preserved. This module is the pure
// aggregation half (validate, average, sort); the file read lives in data.ts.

export interface Review {
  /** 1–5. */
  rating: number;
  text: string | null;
  author: string | null;
  /** ISO date the visit/review is from, used for sort + display. */
  date: string | null;
}

export interface ReviewSummary {
  count: number;
  /** Mean rating rounded to one decimal, 0 when there are none. */
  average: number;
  /** Valid reviews, newest first. */
  reviews: Review[];
}

function isValidReview(r: unknown): r is Review {
  if (typeof r !== 'object' || r === null) return false;
  const rating = (r as { rating?: unknown }).rating;
  return typeof rating === 'number' && Number.isFinite(rating) && rating >= 1 && rating <= 5;
}

/** Validate, average and sort the raw review list for one market. Anything that
 *  isn't a well-formed 1–5 review is dropped rather than trusted. */
export function summarizeReviews(raw: unknown): ReviewSummary {
  const list = (Array.isArray(raw) ? raw : []).filter(isValidReview).map((r) => ({
    rating: Math.round(r.rating),
    text: typeof r.text === 'string' && r.text.trim() ? r.text.trim() : null,
    author: typeof r.author === 'string' && r.author.trim() ? r.author.trim() : null,
    date: typeof r.date === 'string' && r.date.trim() ? r.date.trim() : null,
  }));
  const count = list.length;
  const average = count
    ? Math.round((list.reduce((sum, r) => sum + r.rating, 0) / count) * 10) / 10
    : 0;
  const reviews = list.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
  return { count, average, reviews };
}

/** Full and half stars for a mean rating, e.g. 4.2 -> "★★★★☆". Rounds to the
 *  nearest whole star for a compact, honest glyph row. */
export function starGlyphs(average: number): string {
  const full = Math.round(average);
  return '★★★★★'.slice(0, full) + '☆☆☆☆☆'.slice(0, 5 - full);
}
