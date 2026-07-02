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
  [/bagagerum|car ?boot/, 'bagagerumsmarked'],
  [/antik|antique/, 'antikmarked'],
  [/kr(æ|ae)mmer/, 'kraemmermarked'],
  [/jule|christmas/, 'julemarked'],
  [/genbrug|second ?hand|charity/, 'genbrugsmarked'],
  [/gade|vej|g(å|aa)rd|byloppe|garage/, 'byloppemarked'],
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

/** Extract a Danish postcode (4 digits, 1000-9999) from text. */
export function extractPostcode(text: string): string | null {
  const m = text.match(/\b([1-9]\d{3})\b/);
  return m ? m[1]! : null;
}
