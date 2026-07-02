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

/** Extract a Danish postcode (4 digits, 1000-9999) from text. */
export function extractPostcode(text: string): string | null {
  const m = text.match(/\b([1-9]\d{3})\b/);
  return m ? m[1]! : null;
}
