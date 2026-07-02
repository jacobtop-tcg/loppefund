/** Market categories, normalized across sources. */
export type EventCategory =
  | 'loppemarked'
  | 'kraemmermarked'
  | 'bagagerumsmarked'
  | 'antikmarked'
  | 'genbrugsmarked'
  | 'byloppemarked'
  | 'julemarked'
  | 'andet';

export type IndoorOutdoor = 'indoor' | 'outdoor' | 'mixed' | 'unknown';

export type EventStatus = 'active' | 'cancelled' | 'expired';

/**
 * A concrete dated instance of a market, one per market day.
 * Times are local Danish time; null means the source did not state them —
 * we never invent times.
 */
export interface Occurrence {
  /** ISO date, e.g. "2026-07-05" */
  date: string;
  /** "HH:MM" or null when unknown */
  startTime: string | null;
  endTime: string | null;
}

/**
 * What an adapter extracts from one source document, before canonicalization.
 * Every field is optional except title and sourceUrl — extraction never guesses.
 */
export interface RawEvent {
  sourceKey: string;
  sourceUrl: string;
  sourceEventId: string;
  title: string;
  description?: string;
  category?: EventCategory;
  venueName?: string;
  street?: string;
  postcode?: string;
  city?: string;
  municipality?: string;
  lat?: number;
  lng?: number;
  organizer?: string;
  contactWebsite?: string;
  contactEmail?: string;
  contactPhone?: string;
  priceText?: string;
  isFree?: boolean;
  stallCountText?: string;
  indoorOutdoor?: IndoorOutdoor;
  /** Raw schedule text, e.g. "Søndag i alle ulige uger" — kept for provenance. */
  scheduleText?: string;
  /** Opening hours text, e.g. "Søndag 12-17". */
  openingHoursText?: string;
  /** Explicit date ranges found in the source (whole-day precision). */
  dateRanges?: Array<{ start: string; end: string }>;
  /** Fully resolved occurrences, if the source provides exact times. */
  occurrences?: Occurrence[];
  cancelled?: boolean;
}

/** A canonical market event with provenance and confidence. */
export interface CanonicalEvent {
  id: number;
  slug: string;
  title: string;
  description: string | null;
  category: EventCategory;
  venueName: string | null;
  street: string | null;
  postcode: string | null;
  city: string | null;
  municipality: string | null;
  lat: number | null;
  lng: number | null;
  geocodeQuality: string | null;
  organizer: string | null;
  contactWebsite: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  priceText: string | null;
  isFree: boolean | null;
  stallCountText: string | null;
  indoorOutdoor: IndoorOutdoor;
  scheduleText: string | null;
  openingHoursText: string | null;
  status: EventStatus;
  confidence: number;
  /** field name -> source key that supplied the winning value */
  fieldProvenance: Record<string, string>;
  firstSeenAt: string;
  lastSeenAt: string;
}
