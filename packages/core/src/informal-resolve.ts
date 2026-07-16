/**
 * ENTITY RESOLUTION for informal places — "are these two posts the same barn?"
 *
 * Why not reuse matchEvents (dedupe.ts): that model resolves DATED markets by
 * title + colocation + shared dates. Informal places have no dates, often no
 * real name ("Loppemarked" is not a name), and the identity signals that
 * actually matter here — a phone number, a Facebook profile, a contact person,
 * a recurring rhythm at one address — do not exist in the event model at all.
 *
 * THE RISK THIS MODULE EXISTS TO AVOID: merging two DIFFERENT private sellers.
 * On one village road there may be three unrelated barns. Merging them destroys
 * both records and puts a stranger's goods behind another person's phone number.
 * So the bar is deliberately high: a merge needs a STRONG identity signal (an
 * exact phone or Facebook profile), or several corroborating weak ones. A near
 * miss goes to review, never to an automatic merge.
 */
import type { InformalPlace } from './informal-place.ts';

/**
 * Normalise a Danish phone number to comparable digits.
 * Handles "+45 20 30 40 50", "0045 20304050", "20 30 40 50", "tlf. 20304050".
 * Returns null when it is not a plausible DK number — a partial number must
 * never become a merge key.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let d = raw.replace(/[^\d+]/g, '');
  d = d.replace(/^\+/, '').replace(/^0045/, '45');
  if (d.length === 8) d = `45${d}`; // bare DK number
  if (d.length !== 10 || !d.startsWith('45')) return null;
  const local = d.slice(2);
  // DK subscriber numbers never start with 0 or 1.
  if (/^[01]/.test(local)) return null;
  // Reject obvious placeholders (12345678, 00000000) — they'd merge strangers.
  if (/^(\d)\1{7}$/.test(local) || local === '12345678') return null;
  return d;
}

/** Canonical Facebook identity: profile/page/group id or vanity name. */
export function normalizeFacebookUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw.startsWith('http') ? raw : `https://${raw}`);
    if (!/(^|\.)facebook\.com$/.test(u.hostname) && !/(^|\.)fb\.com$/.test(u.hostname)) return null;
    const groups = u.pathname.match(/\/groups\/([^/]+)/);
    if (groups) return `group:${groups[1]!.toLowerCase()}`;
    const profileId = u.searchParams.get('id');
    if (profileId) return `profile:${profileId}`;
    const seg = u.pathname.split('/').filter(Boolean)[0];
    if (!seg) return null;
    // Post/permalink paths are not an identity.
    if (['posts', 'permalink', 'photo', 'events', 'marketplace', 'story.php'].includes(seg)) {
      return null;
    }
    return `page:${seg.toLowerCase()}`;
  } catch {
    return null;
  }
}

/** Fold a Danish string for comparison: lowercase, æøå unwrapped, punctuation out. */
export function foldName(s: string): string {
  return s
    .toLowerCase()
    .replaceAll('æ', 'ae').replaceAll('ø', 'oe').replaceAll('å', 'aa')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Words too generic to identify a place — "Loppemarked" names nothing. */
const GENERIC_NAME_TOKENS = new Set([
  'loppemarked', 'loppe', 'lopper', 'marked', 'kraemmermarked', 'genbrug', 'salg',
  'privat', 'gaardsalg', 'garagesalg', 'lade', 'loppelade', 'stort', 'lille', 'aabent',
  'nyt', 'gamle', 'den', 'det', 'og', 'paa', 'i', 'ved',
]);

/** The distinctive tokens of a name — what actually identifies it. */
export function distinctiveTokens(name: string): string[] {
  return foldName(name)
    .split(' ')
    .filter((t) => t.length >= 3 && !GENERIC_NAME_TOKENS.has(t));
}

/** Normalise a street for comparison ("Bagvejen 12 B" -> "bagvejen 12b"). */
export function normalizeStreet(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = foldName(raw).replace(/\s+(\d+)\s*([a-z])\b/, ' $1$2');
  return s.length >= 4 && /\d/.test(s) ? s : null;
}

/** Metres between two coordinates. */
export function distanceM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(bLat - aLat);
  const dLng = rad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// ---------------------------------------------------------------------------
// THRESHOLDS — conservative on purpose. Merging two different private sellers
// is a far worse error than leaving a duplicate for a human to fold.
// ---------------------------------------------------------------------------
/** Same phone or same FB identity: near-certain, enough to merge alone. */
export const SCORE_AUTO_MERGE = 100;
/** Below this, not even worth a reviewer's glance. */
export const SCORE_REVIEW_MIN = 55;
/** Two points this close are plausibly the same yard. */
export const SAME_YARD_M = 120;
/** Same road/hamlet — suggestive, never sufficient (neighbours exist). */
export const SAME_AREA_M = 800;

export const RW = {
  samePhone: 100,
  sameFacebook: 100,
  sameStreetAndCity: 45,
  sameYard: 35,
  sameArea: 10,
  sharedDistinctiveName: 30,
  sameContactName: 20,
  sameRecurrence: 8,
  sameType: 5,
  // negatives
  differentPhone: -60,
  differentStreetSameCity: -35,
  differentType: -10,
} as const;

export type MergeVerdict = 'merge' | 'review' | 'distinct';

export interface InformalMatchResult {
  verdict: MergeVerdict;
  score: number;
  /** Danish explanations — a merge must always be justifiable to a human. */
  reasons: string[];
}

type Candidate = Pick<
  InformalPlace,
  | 'canonicalName' | 'aliases' | 'placeType' | 'street' | 'city' | 'lat' | 'lng'
  | 'phone' | 'facebookUrl' | 'contactName' | 'recurrence'
>;

/**
 * Decide whether two records describe the same informal place.
 *
 * Reads as: a hard identity (phone/Facebook) merges; conflicting hard identities
 * veto outright; otherwise weak signals must stack up to reach review.
 */
export function matchInformalPlaces(a: Candidate, b: Candidate): InformalMatchResult {
  const reasons: string[] = [];
  let score = 0;

  const phoneA = normalizePhone(a.phone);
  const phoneB = normalizePhone(b.phone);
  const fbA = normalizeFacebookUrl(a.facebookUrl);
  const fbB = normalizeFacebookUrl(b.facebookUrl);

  // --- hard vetoes first: two different phones = two different people ---
  if (phoneA && phoneB && phoneA !== phoneB) {
    return {
      verdict: 'distinct',
      score: RW.differentPhone,
      reasons: ['Forskellige telefonnumre — næsten sikkert to forskellige sælgere'],
    };
  }

  // --- hard identities: the ONLY thing that may ever auto-merge ---
  let hardIdentity = false;
  if (phoneA && phoneB && phoneA === phoneB) {
    score += RW.samePhone;
    hardIdentity = true;
    reasons.push('Samme telefonnummer');
  }
  if (fbA && fbB && fbA === fbB) {
    score += RW.sameFacebook;
    hardIdentity = true;
    reasons.push('Samme Facebook-profil/side');
  }

  // --- location ---
  const streetA = normalizeStreet(a.street);
  const streetB = normalizeStreet(b.street);
  const cityA = a.city ? foldName(a.city) : null;
  const cityB = b.city ? foldName(b.city) : null;
  const sameCity = !!cityA && cityA === cityB;

  if (streetA && streetB && sameCity) {
    if (streetA === streetB) {
      score += RW.sameStreetAndCity;
      reasons.push('Samme adresse og by');
    } else {
      // Same village, different addresses: a strong hint they are NEIGHBOURS,
      // not the same place. This is the "three barns on one road" guard.
      score += RW.differentStreetSameCity;
      reasons.push('Forskellige adresser i samme by');
    }
  }

  const hasCoords = a.lat != null && a.lng != null && b.lat != null && b.lng != null;
  if (hasCoords) {
    const d = distanceM(a.lat!, a.lng!, b.lat!, b.lng!);
    if (d <= SAME_YARD_M) {
      score += RW.sameYard;
      reasons.push(`Samme gård (${Math.round(d)} m fra hinanden)`);
    } else if (d <= SAME_AREA_M) {
      score += RW.sameArea;
      reasons.push(`Tæt på hinanden (${Math.round(d)} m)`);
    }
  }

  // --- name ---
  const tokensA = new Set([a.canonicalName, ...a.aliases].flatMap(distinctiveTokens));
  const tokensB = new Set([b.canonicalName, ...b.aliases].flatMap(distinctiveTokens));
  const shared = [...tokensA].filter((t) => tokensB.has(t));
  if (shared.length > 0) {
    score += RW.sharedDistinctiveName;
    reasons.push(`Fælles kendetegn i navnet: ${shared.slice(0, 3).join(', ')}`);
  }

  // --- people & habits ---
  if (a.contactName && b.contactName && foldName(a.contactName) === foldName(b.contactName)) {
    score += RW.sameContactName;
    reasons.push('Samme kontaktperson');
  }
  const recA = a.recurrence?.pattern ? foldName(a.recurrence.pattern) : null;
  const recB = b.recurrence?.pattern ? foldName(b.recurrence.pattern) : null;
  if (recA && recA === recB) {
    score += RW.sameRecurrence;
    reasons.push('Samme åbningsmønster');
  }
  if (a.placeType === b.placeType) {
    score += RW.sameType;
  } else {
    score += RW.differentType;
    reasons.push('Forskellig type sted');
  }

  // ONLY a hard identity may auto-merge. Weak signals — even a pile of them —
  // can reach REVIEW at most. Two records at one address with similar names may
  // still be a father and a son running separate sales, or one bad geocode; a
  // human must look. Merging strangers is unrecoverable, a duplicate is not.
  const verdict: MergeVerdict =
    hardIdentity && score >= SCORE_AUTO_MERGE
      ? 'merge'
      : score >= SCORE_REVIEW_MIN
        ? 'review'
        : 'distinct';
  return { verdict, score, reasons };
}

/**
 * A recurring-place signal: does this cluster of observations look like a PLACE
 * with a habit rather than a one-off sale? This is the feature that turns a
 * stream of posts into a hidden gem.
 */
export const RECURRENCE_MIN_OBSERVATIONS = 3;
/** Observations must span at least this long — three posts in one week is one sale. */
export const RECURRENCE_MIN_SPAN_DAYS = 21;

export interface RecurrenceSignal {
  isRecurring: boolean;
  observations: number;
  spanDays: number;
  reason: string;
}

/** Given the observation dates for one resolved place, decide whether it looks
 *  like a recurring spot worth proposing. Conservative: a burst of posts about a
 *  single weekend sale must NOT become a permanent place. */
export function detectRecurrence(observedDates: string[]): RecurrenceSignal {
  const dates = [...new Set(observedDates)].sort();
  const n = dates.length;
  if (n === 0) return { isRecurring: false, observations: 0, spanDays: 0, reason: 'Ingen observationer' };
  const spanDays = Math.round(
    (Date.parse(dates[n - 1]!) - Date.parse(dates[0]!)) / 86_400_000,
  );
  if (n < RECURRENCE_MIN_OBSERVATIONS) {
    return { isRecurring: false, observations: n, spanDays, reason: `Kun ${n} observation(er)` };
  }
  if (spanDays < RECURRENCE_MIN_SPAN_DAYS) {
    return {
      isRecurring: false,
      observations: n,
      spanDays,
      reason: `${n} observationer, men kun over ${spanDays} dage — ligner ét salg`,
    };
  }
  return {
    isRecurring: true,
    observations: n,
    spanDays,
    reason: `Set ${n} gange over ${spanDays} dage — ser ud til at være et tilbagevendende skjult loppested`,
  };
}
