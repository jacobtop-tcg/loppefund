// Community photos for one market. Like reviews, photos are a CURATED bridge:
// a visitor submits via PhotoForm (image goes to the operator inbox), the
// operator vets it, optimizes it into apps/web/public/market-photos/, and lists
// it in data/photos.json committed to the repo. Nothing user-supplied is served
// directly, so quality — and safety — stay under control. This is the pure
// validation half; the file read lives in data.ts.

export interface Photo {
  /** Bare filename under /market-photos, e.g. "broens-lopper-1.jpg". */
  file: string;
  credit: string | null;
  date: string | null;
}

// A photo entry must name a plain image file — no path segments, no traversal,
// no query. Even though photos.json is operator-curated, treat the filename as
// untrusted: a bad value would otherwise become an <img src> on every visit.
const SAFE_FILE = /^[a-z0-9][a-z0-9._-]*\.(jpe?g|png|webp|avif)$/i;

export function summarizePhotos(raw: unknown): Photo[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (p): p is Record<string, unknown> =>
        typeof p === 'object' &&
        p !== null &&
        typeof (p as { file?: unknown }).file === 'string' &&
        !(p as { file: string }).file.includes('/') &&
        !(p as { file: string }).file.includes('..') &&
        SAFE_FILE.test((p as { file: string }).file),
    )
    .map((p) => ({
      file: p.file as string,
      credit:
        typeof p.credit === 'string' && p.credit.trim() ? (p.credit as string).trim() : null,
      date: typeof p.date === 'string' && p.date.trim() ? (p.date as string).trim() : null,
    }));
}
