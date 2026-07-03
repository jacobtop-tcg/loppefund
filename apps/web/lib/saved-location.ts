'use client';

// Device-local memory of the user's location so a returning family lands in
// their own area instead of re-tapping "Nær mig" every visit. Deliberately
// localStorage-ONLY: never a query string, never transmitted — the same
// privacy line the shareable-filter URLs already hold (pos/radius stay out of
// the URL). Coordinates are rounded to ~110 m: plenty for a distance filter,
// no reason to keep pinpoint GPS on disk.

const KEY = 'loppefund:location:v1';

export interface SavedLocation {
  lat: number;
  lng: number;
  radius: number | null;
}

/** Round to 3 decimals (~110 m). Exported for the round-trip test. */
export function coarsen(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function readSavedLocation(): SavedLocation | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<SavedLocation>;
    if (
      typeof v.lat !== 'number' ||
      typeof v.lng !== 'number' ||
      !Number.isFinite(v.lat) ||
      !Number.isFinite(v.lng)
    ) {
      return null;
    }
    const radius = typeof v.radius === 'number' && Number.isFinite(v.radius) ? v.radius : null;
    return { lat: v.lat, lng: v.lng, radius };
  } catch {
    return null;
  }
}

export function writeSavedLocation(loc: SavedLocation): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ lat: coarsen(loc.lat), lng: coarsen(loc.lng), radius: loc.radius }),
    );
  } catch {
    // Private mode / quota — location simply won't be remembered next visit.
  }
}

export function clearSavedLocation(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Nothing to clear in private mode.
  }
}
