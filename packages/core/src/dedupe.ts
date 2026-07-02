/**
 * Duplicate detection between events from different sources.
 * Conservative by design: a missed merge is a minor annoyance,
 * a wrong merge destroys trust.
 */
import { normalizeTitle } from './normalize.ts';

/**
 * Similarity of two titles: Sørensen–Dice over character bigrams of the
 * normalized forms, boosted when one title contains the other (a common
 * pattern when one source decorates the name with a subtitle).
 */
export function titleSimilarity(a: string, b: string): number {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const [shorter, longer] = na.length <= nb.length ? [na, nb] : [nb, na];
  // Containment boost — but only for distinctive titles. A bare category
  // word ("loppemarked", "julemarked") is contained in countless other
  // titles and must never reach the strong-match tier on its own.
  const genericAlone = /^(loppemarked|kr(æ|ae)mmermarked|julemarked|genbrugsmarked|antikmarked|bagagerumsmarked|byttemarked|marked|markedsdag|garagesalg|loppetorv)$/;
  if (
    shorter.length >= 8 &&
    longer.includes(shorter) &&
    !genericAlone.test(shorter) &&
    shorter.split(' ').length >= 2
  ) {
    return 0.9;
  }
  const bigrams = (s: string) => {
    const map = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const bg = s.slice(i, i + 2);
      map.set(bg, (map.get(bg) ?? 0) + 1);
    }
    return map;
  };
  const ba = bigrams(na);
  const bb = bigrams(nb);
  let overlap = 0;
  for (const [bg, count] of ba) {
    overlap += Math.min(count, bb.get(bg) ?? 0);
  }
  const total = (na.length - 1) + (nb.length - 1);
  return total === 0 ? 0 : (2 * overlap) / total;
}

/** Great-circle distance in meters. */
export function distanceMeters(
  lat1: number, lng1: number, lat2: number, lng2: number,
): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export interface MatchCandidate {
  title: string;
  lat?: number | null;
  lng?: number | null;
  postcode?: string | null;
  /** ISO dates of known occurrences */
  dates?: string[];
  /** Normalized category; two different known categories veto a merge. */
  category?: string | null;
  /** Street address; two clearly different streets veto a weak-title merge. */
  street?: string | null;
}

export interface MatchResult {
  isMatch: boolean;
  score: number;
  reason: string;
}

const TITLE_STRONG = 0.85;
const TITLE_WEAK = 0.45;
const NEAR_METERS = 500;

/**
 * Decide whether two events from different sources are the same market.
 * Requires either a strong title match plus location agreement, or a decent
 * title match plus co-location AND overlapping dates. The weak-title path is
 * safe because it demands both location and date corroboration.
 */
export function matchEvents(a: MatchCandidate, b: MatchCandidate): MatchResult {
  // Sources categorize the same market inconsistently (loppemarked vs
  // kræmmermarked vs genbrugsmarked are near-synonyms across taxonomies),
  // so category mismatch alone must not block a merge. The exception is
  // julemarked: a Christmas market at the same venue as a summer flea
  // market is genuinely a different event.
  if (
    a.category && b.category &&
    a.category !== 'andet' && b.category !== 'andet' &&
    a.category !== b.category &&
    (a.category === 'julemarked' || b.category === 'julemarked')
  ) {
    return { isMatch: false, score: 0, reason: 'julemarked vs non-julemarked' };
  }

  const sim = titleSimilarity(a.title, b.title);
  if (sim < TITLE_WEAK) {
    return { isMatch: false, score: sim, reason: 'titles differ' };
  }

  // Two different street addresses is strong evidence of different events —
  // e.g. two garage sales in the same postcode on the same Saturday.
  let streetsDiffer = false;
  if (a.street && b.street) {
    const sa = normalizeTitle(a.street);
    const sb = normalizeTitle(b.street);
    streetsDiffer = sa !== sb && !sa.includes(sb) && !sb.includes(sa);
  }
  if (streetsDiffer && sim < TITLE_STRONG) {
    return { isMatch: false, score: sim, reason: 'different streets' };
  }

  // Streets agree only when BOTH are known and equal/containing — a
  // one-sided street is zero evidence of co-location and must not override
  // coordinates that prove the events are far apart.
  const streetsAgree =
    !streetsDiffer && Boolean(a.street && b.street);

  let colocated: boolean | null = null;
  if (a.lat != null && a.lng != null && b.lat != null && b.lng != null) {
    colocated = distanceMeters(a.lat, a.lng, b.lat, b.lng) <= NEAR_METERS;
    // Geocodes are sometimes wrong (ambiguous street names, postcode
    // centroids). Agreeing postcode + agreeing street outranks distant
    // coordinates.
    if (!colocated && a.postcode && b.postcode && a.postcode === b.postcode && streetsAgree) {
      colocated = true;
    }
  } else if (a.postcode && b.postcode) {
    colocated = a.postcode === b.postcode;
  }

  if (colocated === false) {
    return { isMatch: false, score: sim, reason: 'different locations' };
  }

  const dateOverlap =
    a.dates && b.dates && a.dates.some((d) => b.dates!.includes(d));

  if (sim >= TITLE_STRONG && colocated === true) {
    return { isMatch: true, score: sim, reason: 'strong title + same location' };
  }
  if (sim >= TITLE_STRONG && colocated === null && dateOverlap) {
    return { isMatch: true, score: sim, reason: 'strong title + same dates' };
  }
  if (sim >= TITLE_WEAK && colocated === true && dateOverlap) {
    return { isMatch: true, score: sim, reason: 'title + location + dates' };
  }
  // Distinctive identical titles merge even without location or date overlap —
  // recurring series often publish each date as a separate entry with no
  // address data. Generic titles ("Loppemarked") never qualify.
  // (Contradicting locations already returned above.)
  const na = normalizeTitle(a.title);
  const distinctive = na.length >= 15 || na.split(' ').length >= 3;
  if (sim >= 0.95 && distinctive && !streetsDiffer) {
    return { isMatch: true, score: sim, reason: 'identical distinctive title' };
  }
  return { isMatch: false, score: sim, reason: 'insufficient evidence' };
}
