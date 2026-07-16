/**
 * INFORMAL PLACES — the hidden, informal flea spots that no catalogue holds:
 * private loppelader, gårdsalg, recurring garagesalg, dødsbo lagers, self-service
 * loppeskure, "åbent når flaget er ude".
 *
 * WHY ITS OWN ENTITY (and not an event, and not a venue):
 *  - Not an EVENT: events are dated. An informal place is a PLACE with a habit —
 *    "some Sundays", "when the flag is out", "ring first". Forcing it into
 *    occurrences is the failure mode the codebase already survived once: see
 *    resolveSchedule's MAX_CONSECUTIVE_FILL (schedule.ts), added after a 24/7
 *    private sale exploded into 30 daily markets.
 *  - Not a VENUE: venues (venue.ts) are OSM/chain-sourced businesses, keyed on a
 *    stable external id, with no confidence and no provenance — because they are
 *    corroborated by construction. An informal place is the opposite: a private
 *    person's barn, known only from a Facebook post, needing provenance and a
 *    confidence of its own.
 *
 * Two things make this type structurally different from everything else here:
 *
 *  1. PRIVACY IS A DATA CONCERN, NOT A UI CONCERN. The site is a static export;
 *     anything serialized into the published JSON is world-readable forever and
 *     is mirrored by crawlers. So a private address must never REACH the payload
 *     — hiding it in React is theatre. See informal-visibility.ts, which is the
 *     only sanctioned way to turn a stored place into a publishable one.
 *
 *  2. TWO INDEPENDENT SCORES. `confidence` answers "is this real?" and
 *     `fundScore` answers "is it worth driving to?" — they must never be
 *     conflated. A cluttered private barn known from one post is high-fund /
 *     low-confidence; a well-documented curated antique shop is the reverse.
 *     The existing isHiddenGem() cannot serve: it gates on confidence >= 0.7,
 *     which a tip/Facebook-sourced place can never reach (computeConfidence caps
 *     a lone low-trust source at 0.44), and it requires sourceCount === 1, so
 *     corroboration would REMOVE the badge. See informal-confidence.ts and
 *     fund-score.ts.
 */

/** What kind of informal spot this is. Deliberately NOT EventCategory. */
export type InformalPlaceType =
  | 'loppelade' // private barn full of stuff
  | 'gaardsalg' // farmyard sale
  | 'garagesalg' // recurring garage sale
  | 'doedsbo' // estate-clearance stock
  | 'loppeskur' // self-service shed, honesty box
  | 'privat-hal' // private hall, periodic opening
  | 'foreningsloppe' // club/association sale without a company behind it
  | 'privat-saelger' // a recurring private seller at one address
  | 'genbrugsbod' // informal second-hand stall
  | 'andet';

export const INFORMAL_PLACE_TYPES: readonly InformalPlaceType[] = [
  'loppelade', 'gaardsalg', 'garagesalg', 'doedsbo', 'loppeskur',
  'privat-hal', 'foreningsloppe', 'privat-saelger', 'genbrugsbod', 'andet',
];

/**
 * How much of the location may ever be published.
 *
 * This is enforced in the DATA LAYER (informal-visibility.ts), because on a
 * static host "published" means "public, permanently, to everyone". A private
 * person's home address is not ours to broadcast because a Facebook post
 * mentioned it once.
 *
 * Default for anything user-submitted or scraped is 'omraade' — the cautious
 * choice. 'fuld' requires an affirmative signal (a public business-like place,
 * or explicit consent recorded in the source).
 */
export type AddressVisibility =
  | 'fuld' // full street address may be shown (public/commercial-ish, or consented)
  | 'omraade' // only an approximate area — coordinates are fuzzed before publishing
  | 'kun-aabningsdage' // full address only on confirmed opening days (until then: area)
  | 'kontakt-kraeves' // no address; the visitor must contact first
  | 'intern' // review-only; never published in any form
  | 'ikke-offentlig'; // explicitly refused publication

export const ADDRESS_VISIBILITIES: readonly AddressVisibility[] = [
  'fuld', 'omraade', 'kun-aabningsdage', 'kontakt-kraeves', 'intern', 'ikke-offentlig',
];

/**
 * Lifecycle of an informal place. Deliberately richer than EventStatus
 * ('active'|'cancelled'|'expired'), because "is this barn still a thing?" is a
 * genuinely fuzzy question that a market date never is.
 */
export type InformalPlaceStatus =
  | 'confirmed_active' // verified recently by a human (visit/phone)
  | 'recently_observed' // a fresh source observation, not human-verified
  | 'active_online' // the page/profile is alive and posting
  | 'sporadic' // opens irregularly; expect misses
  | 'call_first' // exists, but you must ring before driving
  | 'unverified' // one weak observation; Radar territory
  | 'possibly_inactive' // stale, or reported closed once
  | 'historical' // was real, appears finished
  | 'rejected'; // reviewed and refused (not a flea spot, or a one-off)

export const INFORMAL_PLACE_STATUSES: readonly InformalPlaceStatus[] = [
  'confirmed_active', 'recently_observed', 'active_online', 'sporadic', 'call_first',
  'unverified', 'possibly_inactive', 'historical', 'rejected',
];

/** How exact the stored coordinate is — about the SOURCE's precision, never about
 *  deliberate fuzzing (that is AddressVisibility's job; conflating the two would
 *  make a fuzzed point look like a bad geocode). */
export type GeoPrecision =
  | 'exact' // a real street address was geocoded
  | 'street' // street known, house number not
  | 'postcode' // postcode/town centroid
  | 'area' // rough region only
  | 'unknown';

/** Where an observation came from — drives the confidence weights. */
export type InformalSourceType =
  | 'facebook_post'
  | 'facebook_page'
  | 'facebook_group'
  | 'event_listing'
  | 'local_paper'
  | 'pdf_paper'
  | 'parish_magazine' // kirkeblad / sogneblad
  | 'association_newsletter'
  | 'local_council' // lokalråd / borgerforening
  | 'obituary_notice' // dødsboannonce
  | 'classified'
  | 'user_tip'
  | 'user_visit'
  | 'phone_verification'
  | 'operator_review'
  | 'website'
  | 'other';

/** One recorded observation of a place — the provenance atom. Never discarded:
 *  a place's whole story must be reconstructible from its sources. */
export interface InformalSourceRecord {
  sourceType: InformalSourceType;
  /** Where it was seen. Null for offline sources (a paper, a phone call). */
  url: string | null;
  /** When the observation was MADE (not when we crawled it). */
  observedAt: string; // ISO date
  /** The relevant quote — enough to justify the record, never the whole post. */
  excerpt: string | null;
  /** Who/what vouched: an operator name, 'pipeline', a reporter pseudonym. */
  verifiedBy: string | null;
}

/** A community visit report. Signals, never gospel — one report may not flip a
 *  place's status on its own (see informal-confidence.ts). */
export interface InformalVisitReport {
  visitedAt: string; // ISO date
  wasOpen: boolean | null;
  priceLevel: PriceLevel | null;
  /** 'meget' | 'noget' | 'lidt' — how much stock was there. */
  stockLevel: 'meget' | 'noget' | 'lidt' | null;
  freshStock: boolean | null; // was there new stuff since last time
  sellerKind: 'privat' | 'professionel' | 'blandet' | null;
  negotiable: boolean | null;
  categories: string[];
  worthTheDrive: boolean | null;
  comment: string | null;
  reporter: string | null;
  reportedClosed: boolean;
}

export type PriceLevel = 'lav' | 'middel' | 'hoej';

/** Recurrence as a HABIT, not a calendar. An informal place rarely has dates;
 *  it has a rhythm, and often only a rumour of one. Free text is preserved
 *  verbatim in `notes` — we never invent a schedule from vague prose. */
export interface InformalRecurrence {
  /** 1=Mon..7=Sun; empty when unknown. */
  weekdays: number[];
  /** e.g. 'hver weekend', 'første søndag i måneden', or null. */
  pattern: string | null;
  /** Season, when stated: [MM-DD, MM-DD]. */
  season: [string, string] | null;
  /** The source's own words. Always kept — the rhythm may be unparseable. */
  notes: string | null;
}

/** What the place is known to carry — used by fund-score and (later) filters. */
export type InventorySignal =
  | 'moebler' | 'dansk-design' | 'keramik' | 'porcelaen' | 'glas' | 'vinyl'
  | 'lego' | 'legetoej' | 'vaerktoej' | 'elektronik' | 'boeger' | 'toej'
  | 'smykker' | 'samlerobjekter' | 'cykler' | 'retro' | 'antik'
  | 'landbrugsantik' | 'lamper' | 'usorteret' | 'blandet';

export const INVENTORY_SIGNALS: readonly InventorySignal[] = [
  'moebler', 'dansk-design', 'keramik', 'porcelaen', 'glas', 'vinyl', 'lego',
  'legetoej', 'vaerktoej', 'elektronik', 'boeger', 'toej', 'smykker',
  'samlerobjekter', 'cykler', 'retro', 'antik', 'landbrugsantik', 'lamper',
  'usorteret', 'blandet',
];

/**
 * The stored shape. This is the INTERNAL record — it may hold a precise address
 * that must never be published. Everything that leaves the build goes through
 * informal-visibility.ts first.
 */
export interface InformalPlace {
  id: number;
  slug: string;
  canonicalName: string;
  aliases: string[];
  placeType: InformalPlaceType;
  description: string | null;

  // --- location (INTERNAL — see AddressVisibility) ---
  street: string | null;
  postcode: string | null;
  city: string | null;
  municipality: string | null;
  region: string | null;
  lat: number | null;
  lng: number | null;
  geoPrecision: GeoPrecision;
  addressVisibility: AddressVisibility;

  // --- contact ---
  contactName: string | null;
  phone: string | null;
  email: string | null;
  facebookUrl: string | null;
  websiteUrl: string | null;

  // --- provenance & lifecycle ---
  sources: InformalSourceRecord[];
  firstSeenAt: string;
  lastSeenAt: string;
  lastVerifiedAt: string | null;
  status: InformalPlaceStatus;

  // --- habits ---
  recurrence: InformalRecurrence | null;
  openingNotes: string | null;
  callBeforeVisiting: boolean;
  openWhenFlagIsOut: boolean;

  // --- scores (computed; see informal-confidence.ts + fund-score.ts) ---
  confidence: number; // 0..100 "is this real?"
  fundScore: number; // 0..100 "is it worth the drive?"

  // --- character ---
  priceLevel: PriceLevel | null;
  inventorySignals: InventorySignal[];
  imageUrls: string[];
  visitReports: InformalVisitReport[];

  // --- bookkeeping ---
  mergedIds: number[];
  moderationNotes: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A place as ingested, before canonicalisation/scoring. */
export type RawInformalPlace = Omit<
  InformalPlace,
  'id' | 'slug' | 'confidence' | 'fundScore' | 'mergedIds' | 'createdAt' | 'updatedAt' | 'aliases'
> & { aliases?: string[] };

/**
 * The three trust layers the UI must keep visibly apart. A Radar place must
 * never be presented like a confirmed one — that is the whole product promise.
 */
export type TrustLayer = 'bekraeftet' | 'kontroller-foerst' | 'radar';

/** Which layer a place belongs in. Deliberately conservative: anything we are
 *  not sure of falls to Radar, and anything needing a phone call says so. */
export function trustLayerFor(place: {
  status: InformalPlaceStatus;
  confidence: number;
  callBeforeVisiting: boolean;
}): TrustLayer {
  if (place.status === 'rejected' || place.status === 'historical') return 'radar';
  if (place.status === 'unverified' || place.status === 'possibly_inactive') return 'radar';
  if (place.confidence < INFORMAL_RADAR_MAX) return 'radar';
  if (place.callBeforeVisiting || place.status === 'call_first' || place.status === 'sporadic') {
    return 'kontroller-foerst';
  }
  if (place.status === 'confirmed_active' && place.confidence >= INFORMAL_CONFIRMED_MIN) {
    return 'bekraeftet';
  }
  return 'kontroller-foerst';
}

/** Below this, a place is Radar only — shown apart, never as a destination. */
export const INFORMAL_RADAR_MAX = 45;
/** At/above this AND confirmed_active, a place may be presented as dependable. */
export const INFORMAL_CONFIRMED_MIN = 70;
