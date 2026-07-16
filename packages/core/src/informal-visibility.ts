/**
 * THE PUBLICATION GATE for informal places.
 *
 * On a static export there is no auth layer and no runtime decision: whatever is
 * serialized into the build is world-readable at a guessable URL, is crawled,
 * and is mirrored by the Wayback Machine — permanently and irrevocably. A React
 * conditional that "hides" a private address is theatre; the coordinate is
 * already in the JSON the browser downloaded.
 *
 * Therefore address visibility is enforced HERE, in the data layer, before a
 * place is ever serialized. `publicView()` is the ONLY sanctioned way to turn a
 * stored InformalPlace into something publishable. Nothing else may read
 * `street`/`lat`/`lng` off a stored place and hand it to the web app.
 *
 * These are private people's homes. A Facebook post mentioning an address once
 * is not consent to broadcast it forever to everyone, next to a one-tap
 * directions link. When in doubt, this module blurs.
 */
import type {
  AddressVisibility,
  InformalSourceRecord,
  GeoPrecision,
  InformalPlace,
  InformalPlaceStatus,
  InformalPlaceType,
  InventorySignal,
  PriceLevel,
} from './informal-place.ts';

/**
 * Grid size for area-level publication, in degrees of latitude.
 * 0.02° ≈ 2.2 km — enough to place a spot in its neighbourhood ("somewhere
 * around Guderup") without pointing at a driveway. Snapping (rather than a
 * random jitter) is deterministic, so the pin never wanders between builds and
 * repeated observation can't triangulate the true point.
 */
export const AREA_GRID_DEG = 0.02;

/** A place as it may be PUBLISHED. Note what is structurally absent: there is no
 *  field here that can carry a precise address for a blurred place, so a UI bug
 *  cannot leak one. */
export interface PublicInformalPlace {
  slug: string;
  name: string;
  placeType: InformalPlaceType;
  description: string | null;
  /** Present ONLY for 'fuld'. */
  street: string | null;
  postcode: string | null;
  city: string | null;
  municipality: string | null;
  lat: number | null;
  lng: number | null;
  /** What the published coordinate actually means. 'area' = deliberately blurred. */
  geoPrecision: GeoPrecision;
  /** True when the coordinate was blurred on purpose — the UI must say so. */
  areaOnly: boolean;
  /** Human-readable reason the address isn't shown, or null when it is. */
  addressNote: string | null;
  phone: string | null;
  facebookUrl: string | null;
  websiteUrl: string | null;
  status: InformalPlaceStatus;
  confidence: number;
  fundScore: number;
  priceLevel: PriceLevel | null;
  inventorySignals: InventorySignal[];
  lastSeenAt: string;
  lastVerifiedAt: string | null;
  callBeforeVisiting: boolean;
  openWhenFlagIsOut: boolean;
  openingNotes: string | null;
  recurrencePattern: string | null;
  /** Public provenance: type + date + url only. Excerpts and reviewer identities
   *  stay internal — provenance must be auditable without republishing someone's
   *  post or naming a moderator. */
  sources: Array<{ sourceType: InformalSourceRecord['sourceType']; url: string | null; observedAt: string }>;
  visitCount: number;
}

/** Snap a coordinate to the centre of its ~2 km cell. Deterministic. */
export function blurCoord(lat: number, lng: number): { lat: number; lng: number } {
  const snap = (v: number, size: number) => Math.round(v / size) * size;
  // Longitude degrees shrink with latitude; widen the lng cell so the blurred
  // area stays roughly square (and roughly as large) across Denmark.
  const lngGrid = AREA_GRID_DEG / Math.max(0.3, Math.cos((lat * Math.PI) / 180));
  return {
    lat: Number(snap(lat, AREA_GRID_DEG).toFixed(5)),
    lng: Number(snap(lng, lngGrid).toFixed(5)),
  };
}

const ADDRESS_NOTE: Record<AddressVisibility, string | null> = {
  fuld: null,
  omraade: 'Kun omtrentligt område — stedet er privat.',
  'kun-aabningsdage': 'Adressen oplyses på åbningsdage — kontakt værten først.',
  'kontakt-kraeves': 'Adressen oplyses ved kontakt.',
  intern: 'Ikke offentlig.',
  'ikke-offentlig': 'Ikke offentlig.',
};

/**
 * Turn a stored place into a publishable one — or null when it may never be
 * published at all.
 *
 * 'kun-aabningsdage' NOTE: on a static host we cannot reveal an address "only on
 * opening days", because shipping it at all ships it forever. It therefore
 * degrades to area-level with a note telling the visitor to make contact. That
 * is the honest consequence of the architecture, not an oversight — and it is
 * why the field still exists: the day this app gains a server, the rule is
 * already modelled and only this branch changes.
 */
export function publicView(place: InformalPlace): PublicInformalPlace | null {
  if (place.addressVisibility === 'intern' || place.addressVisibility === 'ikke-offentlig') {
    return null; // never leaves the build in any form
  }
  if (place.status === 'rejected') return null;

  const showFull = place.addressVisibility === 'fuld';
  const hasCoords = place.lat != null && place.lng != null;
  // Everything that is not explicitly 'fuld' is blurred — including
  // 'kun-aabningsdage' (see above) and 'kontakt-kraeves'.
  const blurred = !showFull && hasCoords ? blurCoord(place.lat!, place.lng!) : null;
  // 'kontakt-kraeves' gets no map point at all: the visitor is meant to make
  // contact, so even an area pin over a hamlet says more than intended.
  const dropPin = place.addressVisibility === 'kontakt-kraeves';

  return {
    slug: place.slug,
    name: place.canonicalName,
    placeType: place.placeType,
    description: place.description,
    street: showFull ? place.street : null,
    // A postcode is a town, not a doorstep — safe to keep for area context.
    postcode: place.postcode,
    city: place.city,
    municipality: place.municipality,
    lat: dropPin ? null : showFull ? place.lat : (blurred?.lat ?? null),
    lng: dropPin ? null : showFull ? place.lng : (blurred?.lng ?? null),
    geoPrecision: showFull ? place.geoPrecision : 'area',
    areaOnly: !showFull,
    addressNote: ADDRESS_NOTE[place.addressVisibility],
    phone: place.phone,
    facebookUrl: place.facebookUrl,
    websiteUrl: place.websiteUrl,
    status: place.status,
    confidence: place.confidence,
    fundScore: place.fundScore,
    priceLevel: place.priceLevel,
    inventorySignals: place.inventorySignals,
    lastSeenAt: place.lastSeenAt,
    lastVerifiedAt: place.lastVerifiedAt,
    callBeforeVisiting: place.callBeforeVisiting,
    openWhenFlagIsOut: place.openWhenFlagIsOut,
    openingNotes: place.openingNotes,
    recurrencePattern: place.recurrence?.pattern ?? null,
    sources: place.sources.map((s) => ({
      sourceType: s.sourceType,
      url: s.url,
      observedAt: s.observedAt,
    })),
    visitCount: place.visitReports.length,
  };
}

/**
 * Guard used by the data-quality report and tests: does a published view leak
 * anything it shouldn't? Returns the violations found (empty = clean).
 *
 * This exists because the leak we fear is silent — a refactor that starts
 * copying `street` through, and nobody notices until a private address is in
 * the Wayback Machine.
 */
export function findVisibilityLeaks(
  stored: InformalPlace,
  view: PublicInformalPlace | null,
): string[] {
  const bad: string[] = [];
  if (stored.addressVisibility === 'intern' || stored.addressVisibility === 'ikke-offentlig') {
    if (view !== null) bad.push(`${stored.slug}: ${stored.addressVisibility} place was published`);
    return bad;
  }
  if (!view) return bad;
  if (stored.addressVisibility !== 'fuld') {
    if (view.street) bad.push(`${stored.slug}: street published despite ${stored.addressVisibility}`);
    if (!view.areaOnly) bad.push(`${stored.slug}: areaOnly flag not set`);
    if (view.lat != null && stored.lat != null) {
      const moved =
        Math.abs(view.lat - stored.lat) > 1e-9 || Math.abs(view.lng! - stored.lng!) > 1e-9;
      if (!moved) bad.push(`${stored.slug}: coordinate published unblurred`);
    }
    if (view.geoPrecision !== 'area') {
      bad.push(`${stored.slug}: geoPrecision '${view.geoPrecision}' leaks real precision`);
    }
  }
  if (stored.addressVisibility === 'kontakt-kraeves' && (view.lat != null || view.lng != null)) {
    bad.push(`${stored.slug}: kontakt-kraeves must not carry a map pin`);
  }
  return bad;
}
