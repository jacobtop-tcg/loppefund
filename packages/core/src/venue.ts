/**
 * Permanent second-hand venues (thrift/charity shops, antique dealers,
 * antiquarian bookshops, permanent flea shops/barns, shelf-rental markets).
 *
 * Unlike an {@link Occurrence}-bearing market, a venue is "always there" and is
 * described by opening hours, not dates. It is deliberately a SEPARATE entity
 * from events so the occurrence/confidence model stays clean. Sourced from
 * OpenStreetMap (ODbL) — the only source whose terms permit storing and
 * displaying names + opening hours in an independent directory.
 */

/** The toggleable venue types the consumer UI groups OSM venues into. */
export type VenueCategory = 'genbrug' | 'antik' | 'loppebutik' | 'reolmarked';

export const VENUE_CATEGORIES: readonly VenueCategory[] = [
  'genbrug',
  'antik',
  'loppebutik',
  'reolmarked',
];

/** One OSM object, mapped to the fields a directory needs. */
export interface RawVenue {
  /** 'node' | 'way' | 'relation' */
  osmType: string;
  osmId: number;
  title: string;
  category: VenueCategory;
  street?: string;
  postcode?: string;
  city?: string;
  municipality?: string;
  lat?: number;
  lng?: number;
  /** Verbatim OSM opening_hours string, kept for display + re-parse. */
  openingHoursText?: string;
  contactWebsite?: string;
  contactPhone?: string;
  description?: string;
}

const fold = (s: string) =>
  s.toLowerCase().replaceAll('æ', 'ae').replaceAll('ø', 'oe').replaceAll('å', 'aa');

// Danish charity-shop operators (folded) — a shop=second_hand run by one of
// these is genbrug even when the name doesn't say so.
const GENBRUG_OPERATORS = [
  'roede kors', 'red barnet', 'kirkens korshaer', 'blaa kors', 'frelsens haer',
  'uff', 'diakonissestiftelsen', 'kirkens genbrug', 'folkekirkens noedhjaelp',
  'danmission', 'kfum', 'kraeftens bekaempelse', 'genbrug til syd', 'mission',
];

/**
 * Bucket an OSM object into one of the four UI venue types. OSM has no distinct
 * tag for loppemarked/loppelade/reolmarked (all `shop=second_hand`), so those
 * are recovered from the name; the shop tag decides the rest. Order matters:
 * the most specific name signals win before the generic tag fallback. A bare
 * commercial `second_hand` with no other signal defaults to `genbrug`, the
 * broadest Danish term for a second-hand shop.
 */
export function classifyVenue(input: {
  shop?: string | null;
  name?: string | null;
  operator?: string | null;
  charity?: string | null;
}): VenueCategory {
  const name = fold(input.name ?? '');
  const operator = fold(input.operator ?? '');
  const shop = (input.shop ?? '').toLowerCase();

  // Name-first: these three types are indistinguishable by tag. "kraemmer"
  // (kræmmermarked — a peddlers'/flea market) belongs with the loppe family,
  // not the default genbrug bucket. `name` is already æøå-folded.
  if (/\breol/.test(name)) return 'reolmarked';
  if (/loppe(marked|torv|land|lade|hus|)?|flea|kraemmer/.test(name)) return 'loppebutik';

  // Antique dealer or antiquarian (used) bookshop.
  if (shop === 'antiques' || shop === 'books') return 'antik';
  if (/\bantik/.test(name)) return 'antik';

  // Charity operator or the word "genbrug" anywhere → genbrug.
  if (shop === 'charity') return 'genbrug';
  if (input.charity === 'yes') return 'genbrug';
  if (/genbrug/.test(name)) return 'genbrug';
  if (GENBRUG_OPERATORS.some((op) => operator.includes(op) || name.includes(op))) return 'genbrug';

  // Generic commercial second-hand: default bucket.
  return 'genbrug';
}
