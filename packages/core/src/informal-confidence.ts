/**
 * HIDDEN-PLACE CONFIDENCE — "is this place real, and is it still a thing?"
 *
 * This is NOT the event confidence model (confidence.ts) and must never be
 * swapped for it. computeConfidence caps a single low-trust source at 0.44 and
 * only lifts it with aggregator corroboration — a calibration that makes sense
 * for markets that appear in several public calendars. An informal place is the
 * exact opposite case: a private barn is, by nature, known from ONE Facebook
 * post, and that lone post can still be perfectly true. Judging it by the event
 * model would mark every real hidden place as junk, which is the whole reason
 * this datatype exists.
 *
 * It is also NOT fund-score (fund-score.ts): "is it real?" and "is it worth the
 * drive?" are independent questions. A cluttered dødsbo barn known from one post
 * is low-confidence / high-fund. A polished antique dealer with a webshop is the
 * reverse.
 *
 * DESIGN RULES
 *  - Transparent points, never a black box: every weight is a named constant
 *    here, and every score comes back with the Danish reasons that produced it,
 *    so the UI can explain itself and a human can argue with it.
 *  - Deterministic and pure: same input, same score. It runs in the build.
 *  - Evidence, not vibes: each signal must name a fact in the record.
 *  - Recency decays. A barn observed once, three years ago, is a rumour.
 */
import type {
  InformalPlace,
  InformalSourceRecord,
  InformalSourceType,
  InformalVisitReport,
} from './informal-place.ts';

// ---------------------------------------------------------------------------
// WEIGHTS — the whole model lives here. Change scoring ONLY by editing these.
// ---------------------------------------------------------------------------
export const INFORMAL_W = {
  /** A precise street address in a source: the single strongest "someone really
   *  knows this place" signal. */
  preciseAddress: 14,
  /** A phone number — you can ring it; it also anchors entity resolution. */
  phone: 10,
  /** Each INDEPENDENT source beyond the first (capped). Independence is what
   *  makes corroboration meaningful; five reposts of one post are one source. */
  perExtraSource: 9,
  maxExtraSources: 3,
  /** The same address seen in more than one observation. */
  repeatedAddress: 8,
  /** Repeated posts from the same author/profile — a habit, not a one-off. */
  repeatedAuthor: 7,
  /** A recurring opening rhythm is stated. */
  recurrence: 8,
  /** Photos of the physical place. */
  photos: 6,
  /** A human confirmed by visiting. */
  userVisitConfirmed: 12,
  /** A human confirmed by telephone — the strongest verification we can get. */
  phoneVerified: 16,
  /** Contact details agree across sources. */
  consistentContact: 6,
  /** An unambiguous geocode (a real point, not a postcode centroid). */
  exactGeo: 6,
  /** Clear opening hours stated. */
  clearHours: 5,

  // --- negatives ---
  conflictingAddress: -18,
  conflictingDates: -8,
  deadLink: -7,
  /** Only ONE observation, and it is old (see STALE_DAYS). */
  singleOldObservation: -14,
  /** Unclear whether flea goods are actually sold here. */
  unclearIfFlea: -12,
  /** Reported closed by a visitor (per report, capped). */
  perClosedReport: -10,
  maxClosedReports: 2,
  /** Looks like a one-off private sale, not a place with a habit. */
  looksOneOff: -15,
  /** Probable duplicate of another record. */
  probableDuplicate: -10,
} as const;

/** Recency: full credit under FRESH_DAYS, decaying to zero at STALE_DAYS. */
export const FRESH_DAYS = 60;
export const STALE_DAYS = 540;
export const W_RECENCY_MAX = 18;

/** A lone observation older than this counts as stale (singleOldObservation). */
export const SINGLE_OBS_STALE_DAYS = 180;

/** Visit reports are signals, not votes: no single report may swing the score,
 *  so the closed-penalty needs a quorum before it bites at full weight. */
export const CLOSED_REPORT_QUORUM = 2;

const BASE = 20;

/** Sources that are a human vouching, not a machine scraping. */
const HUMAN_SOURCES: ReadonlySet<InformalSourceType> = new Set([
  'user_tip', 'user_visit', 'phone_verification', 'operator_review',
]);

export interface InformalConfidenceInput {
  sources: InformalSourceRecord[];
  visitReports: InformalVisitReport[];
  street: string | null;
  phone: string | null;
  lat: number | null;
  lng: number | null;
  geoPrecision: InformalPlace['geoPrecision'];
  recurrence: InformalPlace['recurrence'];
  openingNotes: string | null;
  imageUrls: string[];
  lastSeenAt: string;
  lastVerifiedAt: string | null;
  /** Flags a reviewer or the classifier can set — evidence we can't infer. */
  flags?: {
    conflictingAddress?: boolean;
    conflictingDates?: boolean;
    deadLink?: boolean;
    unclearIfFlea?: boolean;
    looksOneOff?: boolean;
    probableDuplicate?: boolean;
    consistentContact?: boolean;
    repeatedAuthor?: boolean;
    repeatedAddress?: boolean;
  };
}

export interface InformalConfidenceResult {
  /** 0..100 */
  score: number;
  /** Danish, user-facing, ordered strongest first. */
  reasons: string[];
  /** One-line summary for the UI. */
  summary: string;
}

const daysBetween = (a: string, b: string): number =>
  Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

/** Independent = distinct (sourceType, url-host). Reposts of one post are one. */
function independentSourceCount(sources: InformalSourceRecord[]): number {
  const keys = new Set<string>();
  for (const s of sources) {
    let host = '';
    if (s.url) {
      try {
        host = new URL(s.url).hostname.replace(/^www\./, '');
      } catch {
        host = s.url.slice(0, 40);
      }
    }
    keys.add(`${s.sourceType}|${host}`);
  }
  return keys.size;
}

/**
 * Score a place's realness. `today` is injected so the model stays pure and
 * testable (and so a build is reproducible).
 */
export function computeInformalConfidence(
  input: InformalConfidenceInput,
  today: string,
): InformalConfidenceResult {
  let score = BASE;
  const reasons: string[] = [];
  const f = input.flags ?? {};

  // --- positives ---
  if (input.street) {
    score += INFORMAL_W.preciseAddress;
    reasons.push('Præcis adresse oplyst i en kilde');
  }
  if (input.phone) {
    score += INFORMAL_W.phone;
    reasons.push('Telefonnummer oplyst');
  }

  const independent = independentSourceCount(input.sources);
  const extra = Math.min(Math.max(independent - 1, 0), INFORMAL_W.maxExtraSources);
  if (extra > 0) {
    score += extra * INFORMAL_W.perExtraSource;
    reasons.push(`Set i ${independent} uafhængige kilder`);
  }

  if (f.repeatedAddress) {
    score += INFORMAL_W.repeatedAddress;
    reasons.push('Samme adresse observeret flere gange');
  }
  if (f.repeatedAuthor) {
    score += INFORMAL_W.repeatedAuthor;
    reasons.push('Gentagne opslag fra samme profil');
  }
  if (input.recurrence && (input.recurrence.weekdays.length > 0 || input.recurrence.pattern)) {
    score += INFORMAL_W.recurrence;
    reasons.push('Tilbagevendende åbning oplyst');
  }
  if (input.imageUrls.length > 0) {
    score += INFORMAL_W.photos;
    reasons.push('Billeder af stedet');
  }
  if (input.geoPrecision === 'exact') {
    score += INFORMAL_W.exactGeo;
    reasons.push('Entydig geolokation');
  }
  if (input.openingNotes) {
    score += INFORMAL_W.clearHours;
    reasons.push('Åbningstider oplyst');
  }
  if (f.consistentContact) {
    score += INFORMAL_W.consistentContact;
    reasons.push('Kontaktdata stemmer på tværs af kilder');
  }

  const phoneVerified = input.sources.some((s) => s.sourceType === 'phone_verification');
  if (phoneVerified) {
    score += INFORMAL_W.phoneVerified;
    reasons.push('Bekræftet telefonisk');
  }
  const confirmedVisits = input.visitReports.filter((r) => r.wasOpen === true && !r.reportedClosed);
  if (confirmedVisits.length > 0) {
    score += INFORMAL_W.userVisitConfirmed;
    reasons.push(`Bekræftet ved besøg (${confirmedVisits.length})`);
  }

  // --- recency: a place is only as current as its last sighting ---
  const age = daysBetween(input.lastVerifiedAt ?? input.lastSeenAt, today);
  if (age <= FRESH_DAYS) {
    score += W_RECENCY_MAX;
    reasons.push(`Aktivitet inden for ${Math.max(age, 0)} dage`);
  } else if (age < STALE_DAYS) {
    const decayed = Math.round(
      W_RECENCY_MAX * (1 - (age - FRESH_DAYS) / (STALE_DAYS - FRESH_DAYS)),
    );
    score += decayed;
    if (decayed > 0) reasons.push(`Senest set for ${age} dage siden`);
  } else {
    reasons.push(`Ingen aktivitet i ${age} dage`);
  }

  // --- negatives ---
  if (input.sources.length <= 1 && age > SINGLE_OBS_STALE_DAYS) {
    score += INFORMAL_W.singleOldObservation;
    reasons.push('Kun én gammel observation');
  }
  if (f.conflictingAddress) {
    score += INFORMAL_W.conflictingAddress;
    reasons.push('Modstridende adresse i kilderne');
  }
  if (f.conflictingDates) {
    score += INFORMAL_W.conflictingDates;
    reasons.push('Modstridende datoer');
  }
  if (f.deadLink) {
    score += INFORMAL_W.deadLink;
    reasons.push('Kilde-link er dødt');
  }
  if (f.unclearIfFlea) {
    score += INFORMAL_W.unclearIfFlea;
    reasons.push('Uklart om der sælges lopper');
  }
  if (f.looksOneOff) {
    score += INFORMAL_W.looksOneOff;
    reasons.push('Ligner et enkeltstående privatsalg');
  }
  if (f.probableDuplicate) {
    score += INFORMAL_W.probableDuplicate;
    reasons.push('Sandsynlig dublet');
  }
  const closed = input.visitReports.filter((r) => r.reportedClosed).length;
  if (closed > 0) {
    // Quorum: one disappointed visitor is not proof the barn is gone.
    const effective = closed >= CLOSED_REPORT_QUORUM ? Math.min(closed, INFORMAL_W.maxClosedReports) : 0.5;
    score += Math.round(effective * INFORMAL_W.perClosedReport);
    reasons.push(
      closed >= CLOSED_REPORT_QUORUM
        ? `Rapporteret lukket af ${closed} besøgende`
        : 'Rapporteret lukket af én besøgende',
    );
  }

  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  return { score: clamped, reasons, summary: summarize(clamped, reasons) };
}

function summarize(score: number, reasons: string[]): string {
  const head = reasons.slice(0, 3).join(', ').toLowerCase();
  const band =
    score >= 80 ? 'Meget sikker' : score >= 60 ? 'Ret sikker' : score >= 45 ? 'Usikker' : 'Ubekræftet';
  return head ? `${band} — ${head}.` : band;
}
