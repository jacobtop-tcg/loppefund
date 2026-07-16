import 'server-only';
import {
  publicView,
  findVisibilityLeaks,
  searchFold,
  trustLayerFor,
  type InformalPlace,
  type PublicInformalPlace,
  type TrustLayer,
} from '@loppefund/core';
import { listInformalPlaces } from '@loppefund/db';
import { getDb } from './data.ts';
import { PLACE_TYPE_LABELS, SIGNAL_LABELS } from './informal-labels.ts';

/**
 * THE PUBLICATION BOUNDARY for informal places.
 *
 * This module is the ONLY thing in the web app allowed to touch a stored
 * informal place, and everything it returns has already been through
 * publicView(). That placement is the whole privacy design: the site is a
 * static export, so any street or precise coordinate that reaches a page or a
 * JSON asset is world-readable forever and mirrored by crawlers. Filtering in
 * React would be theatre — the value would already be in the payload the
 * browser downloaded.
 *
 * So: raw rows in, published views out, and no way for a caller to ask for the
 * unblurred version. A UI bug therefore cannot leak a private address, because
 * the UI never has one.
 */

export interface InformalPlaceSummary extends PublicInformalPlace {
  /** Which of the three trust layers this belongs in (bekraeftet /
   *  kontroller-foerst / radar). Precomputed — the client must never re-derive
   *  it and accidentally promote a Radar place. */
  trustLayer: TrustLayer;
  /** Folded blob so client search can match without shipping a second index. */
  searchText: string;
}

/** Map a DB row to the internal shape publicView() expects. */
function toInternal(r: ReturnType<typeof listInformalPlaces>[number]): InformalPlace {
  const j = <T,>(s: string | null, fallback: T): T => {
    if (!s) return fallback;
    try {
      return JSON.parse(s) as T;
    } catch {
      return fallback;
    }
  };
  return {
    id: r.id,
    slug: r.slug,
    canonicalName: r.canonical_name,
    aliases: j<string[]>(r.aliases, []),
    placeType: r.place_type as InformalPlace['placeType'],
    description: r.description,
    street: r.street,
    postcode: r.postcode,
    city: r.city,
    municipality: r.municipality,
    region: r.region,
    lat: r.lat,
    lng: r.lng,
    geoPrecision: r.geo_precision as InformalPlace['geoPrecision'],
    addressVisibility: r.address_visibility as InformalPlace['addressVisibility'],
    contactName: r.contact_name,
    phone: r.phone,
    email: r.email,
    facebookUrl: r.facebook_url,
    websiteUrl: r.website_url,
    sources: (r.sources as Array<Record<string, string | null>>).map((s) => ({
      sourceType: s.source_type as InformalPlace['sources'][number]['sourceType'],
      url: s.url,
      observedAt: s.observed_at!,
      excerpt: s.excerpt,
      verifiedBy: s.verified_by,
    })),
    firstSeenAt: r.first_seen_at,
    lastSeenAt: r.last_seen_at,
    lastVerifiedAt: r.last_verified_at,
    status: r.status as InformalPlace['status'],
    recurrence: j<InformalPlace['recurrence']>(r.recurrence, null),
    openingNotes: r.opening_notes,
    callBeforeVisiting: !!r.call_before_visiting,
    openWhenFlagIsOut: !!r.open_when_flag_is_out,
    confidence: r.confidence,
    fundScore: r.fund_score,
    priceLevel: r.price_level as InformalPlace['priceLevel'],
    inventorySignals: j<InformalPlace['inventorySignals']>(r.inventory_signals, []),
    imageUrls: j<string[]>(r.image_urls, []),
    visitReports: (r.reports as unknown[]).map(() => ({}) as InformalPlace['visitReports'][number]),
    mergedIds: j<number[]>(r.merged_ids, []),
    moderationNotes: r.moderation_notes,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/**
 * Every publishable informal place.
 *
 * Returns [] on a pre-v4 database — the guard lives in listInformalPlaces, and
 * it matters: migrate() runs only from openDb(), while a code-push deploy builds
 * from a cached DB that may predate these tables. Without that, adding this
 * feature would take the whole site down on the next push.
 */
export function listPublicInformalPlaces(): InformalPlaceSummary[] {
  const out: InformalPlaceSummary[] = [];
  for (const row of listInformalPlaces(getDb())) {
    const internal = toInternal(row);
    const view = publicView(internal);
    if (!view) continue; // intern / ikke-offentlig / rejected — never published

    // Belt and braces: if a refactor ever starts leaking a precise value, drop
    // the place rather than publish it. A missing place is a nuisance; a
    // published home address is not recoverable.
    if (findVisibilityLeaks(internal, view).length > 0) continue;

    out.push({
      ...view,
      trustLayer: trustLayerFor(internal),
      // Index everything the CARD shows, in the words it shows them in.
      // Anything visible but unindexed is a broken promise: a visitor who reads
      // "Værktøj" on a card and types it into the search box must not be told
      // there is nothing. So the Danish labels go in — not the internal slugs —
      // alongside the free-text opening notes and the recurrence rumour.
      searchText: searchFold(
        [
          view.name,
          view.city,
          view.municipality,
          view.postcode,
          PLACE_TYPE_LABELS[view.placeType],
          view.placeType,
          ...view.inventorySignals.map((s) => SIGNAL_LABELS[s]),
          view.recurrencePattern ?? '',
          view.openingNotes ?? '',
          view.description ?? '',
        ]
          .filter(Boolean)
          .join(' '),
      ),
    });
  }
  return out;
}

/** One place by slug, already published-safe, or null. */
export function getPublicInformalPlace(slug: string): InformalPlaceSummary | null {
  return listPublicInformalPlaces().find((p) => p.slug === slug) ?? null;
}

/**
 * Slugs for generateStaticParams.
 *
 * NEVER returns an empty array: `output: export` errors on an empty dynamic
 * route and that kills the deploy — and an empty set is the NORMAL case here
 * (a cached pre-v4 DB, or simply no vetted places yet). The sentinel renders a
 * notFound() page, exactly as /sted/[slug] already does.
 */
export function informalPlaceSlugs(): Array<{ slug: string }> {
  const slugs = listPublicInformalPlaces().map((p) => ({ slug: p.slug }));
  return slugs.length > 0 ? slugs : [{ slug: '__none__' }];
}
