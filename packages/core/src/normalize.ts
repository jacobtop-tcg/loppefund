import type { EventCategory, IndoorOutdoor } from './types.ts';

/** Lowercase, strip diacritics to ascii (æ->ae, ø->oe, å->aa), drop noise. */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replaceAll('æ', 'ae')
    .replaceAll('ø', 'oe')
    .replaceAll('å', 'aa')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function slugify(text: string): string {
  return normalizeTitle(text).replace(/ /g, '-').slice(0, 80);
}

/**
 * A venue label must be a short place name, not prose. Some sources dump a whole
 * travel-directions paragraph into venue_name; it then renders as the location
 * line. Reject anything too long or multi-sentence so display falls back to the
 * clean street/city.
 */
export function cleanVenueName(name: string | null | undefined): string | null {
  if (!name) return null;
  const n = name.replace(/\s+/g, ' ').trim();
  if (!n || n.length > 80 || /[.!?]\s+\S/.test(n)) return null;
  return n;
}

/**
 * Some sources put a vague locality where a street belongs — "Byens gader" (the
 * town's streets), "hele byen", "flere steder". That is not an address: it must
 * not render as one, and it must not count as a distinguishing street in dedup
 * (two entries of the same market, one addressed "Byens gader" and one with the
 * real street, would otherwise never merge). Returns the street unchanged, or
 * null when it is one of these placeholders. A real address (with a house
 * number, or a specific named square like "Torvet") passes through untouched.
 */
const VAGUE_STREETS: ReadonlySet<string> = new Set([
  'byens gader', 'byens gade', 'hele byen', 'i hele byen', 'rundt i byen',
  'flere steder', 'flere steder i byen', 'diverse', 'diverse steder',
  'forskellige steder', 'hele området', 'ingen adresse',
]);
export function cleanStreet(street: string | null | undefined): string | null {
  if (!street) return null;
  const s = street.trim();
  if (!s) return null;
  const n = s.toLowerCase().replace(/[.,]/g, ' ').replace(/\s+/g, ' ').trim();
  return VAGUE_STREETS.has(n) ? null : s;
}

/**
 * Sanitize a `city` an adapter over-stuffed with street/postcode fragments —
 * e.g. ", 6640 Lunderskov, 6640 Lunderskov, 6640 Lunderskov" or
 * "Kastaniehøjvej 6, 8600 Silkeborg" — down to a clean town name. Prefers the
 * comma-segment tied to the postcode, strips a leading 4-digit postcode, and
 * de-duplicates repeats. A clean city ("Svendborg") passes through untouched.
 */
export function cleanCity(
  city: string | null | undefined,
  postcode?: string | null,
): string | null {
  if (!city) return null;
  const segs = [...new Set(city.split(',').map((s) => s.trim()).filter(Boolean))];
  if (segs.length === 0) return null;
  const pick =
    (postcode ? segs.find((s) => s.startsWith(postcode)) : undefined) ??
    segs[segs.length - 1]!;
  const afterPc = pick.match(/^[1-9]\d{3}\s+(.+)$/);
  // A Danish postal city never contains " på " — when it appears it is a venue/
  // place descriptor that address parsing trailed onto the city ("Lyngby på
  // Johannes Fogs Plads" -> "Lyngby"). Strip it, plus any dangling end period.
  const out = (afterPc ? afterPc[1]! : pick)
    .replace(/\s+på\s+.+$/i, '')
    .replace(/\.\s*$/, '')
    .trim();
  return out || null;
}

const CATEGORY_PATTERNS: Array<[RegExp, EventCategory]> = [
  // Jule first: "Julekræmmermarked" is seasonally a julemarked, and the
  // julemarked/non-julemarked distinction feeds the dedup veto.
  // (?<!h) keeps "hjulet"/"tohjulede" from reading as jule.
  [/(?<!h)jule|(^|\s)jul(?=$|\s|e)|christmas/i, 'julemarked'],
  [/bagagerum|car ?boot/, 'bagagerumsmarked'],
  [/antik|antique/, 'antikmarked'],
  [/kr(æ|ae)mmer/, 'kraemmermarked'],
  // Compound only — bare "genbrug" is the material, not a market.
  [/genbrugsmarked|genbrugssalg|genbrugsbutik|second ?hand|charity/, 'genbrugsmarked'],
  // Compounds only — a bare "vej"/"gade" would match every Danish street name.
  [/gade\/vej|gadeloppe|vejloppe|g(å|aa)rdloppe|byloppe|gadesalg|garage/, 'byloppemarked'],
  [/loppe|flea|vintage/, 'loppemarked'],
];

/** Map free-text category/type labels to a normalized category. */
export function normalizeCategory(text: string | undefined): EventCategory {
  if (!text) return 'andet';
  const t = text.toLowerCase();
  for (const [re, cat] of CATEGORY_PATTERNS) {
    if (re.test(t)) return cat;
  }
  return 'andet';
}

export function normalizeIndoorOutdoor(text: string | undefined): IndoorOutdoor {
  if (!text) return 'unknown';
  const t = text.toLowerCase();
  const indoor = /inden|indoor/.test(t);
  const outdoor = /uden|outdoor/.test(t);
  if (indoor && outdoor) return 'mixed';
  if (indoor) return 'indoor';
  if (outdoor) return 'outdoor';
  return 'unknown';
}

/** "Gratis" / "0 kr" -> true; explicit amounts -> false; unknown -> null. */
export function parseIsFree(priceText: string | undefined): boolean | null {
  if (!priceText) return null;
  const t = priceText.toLowerCase();
  if (/gratis|fri entr|ingen entr|^0\s*(kr|,-)?$/.test(t)) return true;
  if (/\d/.test(t)) return false;
  return null;
}

/**
 * Fold Danish letters for search indexing. Two conventions exist in the wild:
 * transliteration (ø→oe) and lazy typing (ø→o); we index both so queries in
 * either style hit.
 */
export function searchFold(text: string): string {
  const lower = text.toLowerCase();
  const translit = lower
    .replaceAll('æ', 'ae')
    .replaceAll('ø', 'oe')
    .replaceAll('å', 'aa');
  const lazy = lower
    .replaceAll('æ', 'ae')
    .replaceAll('ø', 'o')
    .replaceAll('å', 'a');
  return `${translit} ${lazy}`;
}

const DATE_TOKEN =
  /\b(mandag|tirsdag|onsdag|torsdag|fredag|l(ø|oe)rdag|s(ø|oe)ndag|januar|februar|marts|april|maj|juni|juli|august|september|oktober|november|december)\b|\bd\.\s*\d|\d{1,2}[./-]\d{1,2}/i;

/** Does a title carry date tokens ("Loppemarked lørdag d. 5. juli")? */
export function titleHasDateTokens(title: string): boolean {
  return DATE_TOKEN.test(title);
}

const MONTHS_RE = 'januar|februar|marts|april|maj|juni|juli|august|september|oktober|november|december';

/**
 * Strip date / weekday / time fragments from a title so a recurring market keeps
 * a clean, stable name ("Loppemarked lørdag d. 4. juli 2026" -> "Loppemarked").
 * A baked-in date is both wrong (it contradicts the other occurrences a user
 * sees) and splits one market into many un-mergeable records. Conservative: only
 * touches recognized fragments and falls back to the original if nothing
 * meaningful would remain.
 */
export function stripDateTokens(title: string): string {
  if (!titleHasDateTokens(title)) return title;
  let s = title
    .replace(/\bkl\.?\s*\d{1,2}(?:[.:]\d{2})?\s*[-–]\s*\d{1,2}(?:[.:]\d{2})?/gi, ' ')
    .replace(new RegExp(`\\b(?:den|d)\\.?\\s*\\d{1,2}\\.?\\s*(?:${MONTHS_RE})(?:\\s*\\d{4})?`, 'gi'), ' ')
    .replace(new RegExp(`\\b\\d{1,2}\\.?\\s*(?:${MONTHS_RE})(?:\\s*\\d{4})?`, 'gi'), ' ')
    .replace(/\b\d{1,2}[./-]\d{1,2}(?:[./-]\d{2,4})?\b/g, ' ')
    .replace(/\b(?:mandag|tirsdag|onsdag|torsdag|fredag|l(?:ø|oe)rdag|s(?:ø|oe)ndag)e?\b/gi, ' ')
    .replace(/\b20\d{2}\b/g, ' ')
    .replace(/\bd\.\s*/gi, ' ');
  s = s
    .replace(/\(\s*\)/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.])/g, '$1')
    .replace(/[\s,–-]+$/, '')
    .replace(/^[\s,–-]+/, '')
    .trim();
  return s.length >= 3 ? s : title;
}

/** Extract a Danish postcode (4 digits, 1000-9999) from text. */
export function extractPostcode(text: string): string | null {
  const m = text.match(/\b([1-9]\d{3})\b/);
  return m ? m[1]! : null;
}
