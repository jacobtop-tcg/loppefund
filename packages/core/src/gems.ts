/**
 * "Skjult perle" (hidden gem): a deterministic heuristic for markets that are
 * complete and confident but likely unknown — single-source, few dates, not
 * huge, yet unusually well-described.
 *
 * Calibration against the 2026-07-02 snapshot (722 active events): the
 * points distribution was 4:72 / 5:100 / 6:76 / 7:13; threshold 6 with the
 * gates below yields ~12% gems. Retune against fresh data, not in the dark.
 */

export interface HiddenGemInput {
  confidence: number;
  /** Distinct source_keys corroborating the event. */
  sourceCount: number;
  /** Occurrences within the listing window. */
  occurrenceCount: number;
  hasLocation: boolean;
  descriptionLength: number;
  stallCountText: string | null;
  isFreeKnown: boolean;
  hasTimedOccurrence: boolean;
  hasVenueName: boolean;
  hasOrganizerOrWebsite: boolean;
}

/** First integer in the text ("Ca. 100 stande" -> 100, "30-40 boder" -> 30). */
export function parseStallCount(text: string | null): number | null {
  const m = text?.match(/\d{1,4}/);
  return m ? Number(m[0]) : null;
}

export const GEM_POINTS_THRESHOLD = 6;
export const GEM_MIN_CONFIDENCE = 0.7;
export const GEM_MAX_OCCURRENCES = 6; // excludes always-open venues and weekly series
export const GEM_MAX_STALLS = 150; // big kræmmermarkeder are not hidden

/**
 * Completeness points 0..7: description >= 200 chars -> 2 (>= 80 -> 1);
 * +1 each for stall count, known entry fee, timed occurrence, venue name,
 * organizer-or-website.
 */
export function hiddenGemScore(i: HiddenGemInput): number {
  let points = 0;
  if (i.descriptionLength >= 200) points += 2;
  else if (i.descriptionLength >= 80) points += 1;
  if (i.stallCountText) points += 1;
  if (i.isFreeKnown) points += 1;
  if (i.hasTimedOccurrence) points += 1;
  if (i.hasVenueName) points += 1;
  if (i.hasOrganizerOrWebsite) points += 1;
  return points;
}

export function isHiddenGem(i: HiddenGemInput): boolean {
  if (i.confidence < GEM_MIN_CONFIDENCE) return false;
  if (i.sourceCount !== 1) return false; // on 2+ aggregators = not hidden
  if (i.occurrenceCount < 1 || i.occurrenceCount > GEM_MAX_OCCURRENCES) return false;
  if (!i.hasLocation) return false;
  const stalls = parseStallCount(i.stallCountText);
  if (stalls !== null && stalls > GEM_MAX_STALLS) return false;
  return hiddenGemScore(i) >= GEM_POINTS_THRESHOLD;
}
