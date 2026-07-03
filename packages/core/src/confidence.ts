/**
 * Event confidence scoring, 0..1. Transparent and explainable:
 * every component is visible so the UI can justify the score.
 */

export interface ConfidenceInput {
  /** Trust of the most trusted contributing source, 0..1. */
  maxSourceTrust: number;
  /** Number of independent sources corroborating the event. */
  sourceCount: number;
  /** Days since the event was last seen/verified on any source. */
  daysSinceVerified: number;
  /** Do we have coordinates with good geocode quality? */
  hasGoodLocation: boolean;
  /** Do we have at least one concrete upcoming occurrence? */
  hasConcreteDates: boolean;
}

export function computeConfidence(input: ConfidenceInput): number {
  let score = input.maxSourceTrust * 0.5;

  // Corroboration: each extra source adds, capped.
  score += Math.min(input.sourceCount - 1, 2) * 0.1;

  // Freshness decay: full weight under 14 days, fades to 0 at 120 days.
  const freshness = Math.max(0, 1 - Math.max(0, input.daysSinceVerified - 14) / 106);
  score += freshness * 0.2;

  if (input.hasGoodLocation) score += 0.1;
  if (input.hasConcreteDates) score += 0.1;

  score = Math.min(1, Math.max(0, Math.round(score * 100) / 100));

  // A single low-trust source is unverified by definition — one uncorroborated
  // Facebook post or community tip (trust <= 0.4) must NOT be promoted past the
  // "bekræftet" line by location/date/freshness bonuses alone. Corroboration
  // (a second source) or a genuinely trustworthy sole source (a public calendar,
  // trust >= 0.5) is required to clear the threshold. Keeps the label honest:
  // "we found this in one low-trust place" reads as ubekræftet.
  if (input.sourceCount <= 1 && input.maxSourceTrust < SINGLE_SOURCE_VERIFIED_TRUST) {
    score = Math.min(score, UNVERIFIED_THRESHOLD - 0.01);
  }

  return score;
}

/** UI threshold below which events are labelled "ubekræftet". */
export const UNVERIFIED_THRESHOLD = 0.45;

/**
 * Sole-source trust floor for clearing UNVERIFIED_THRESHOLD. Public calendars
 * (markedskalenderen 0.7, kultunaut 0.65, loppemarkeder.nu 0.6, findmarked /
 * sydfynskalenderen 0.55) sit above it; Facebook (0.4) and community tips
 * (0.35) sit below and stay "ubekræftet" until a second source corroborates.
 */
export const SINGLE_SOURCE_VERIFIED_TRUST = 0.5;
