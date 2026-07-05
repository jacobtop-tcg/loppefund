/**
 * Canonicalization: turn RawEvents into canonical events with dedup,
 * field-level provenance, occurrence materialization and confidence.
 */
import type { DatabaseSync } from 'node:sqlite';
import {
  computeConfidence,
  cleanCity,
  cleanStreet,
  cleanVenueName,
  extractAmenities,
  extractStallCountText,
  inferIndoorOutdoor,
  inferIsFreeFromText,
  matchEvents,
  type MatchCandidate,
  normalizeCategory,
  normalizeTitle,
  resolveSchedule,
  slugify,
  stripDateTokens,
  titleHasDateTokens,
  type IndoorOutdoor,
  type Occurrence,
  type RawEvent,
} from '@loppefund/core';
import {
  findCandidateEvents,
  insertEvent,
  linkEventSource,
  occurrenceDates,
  replaceOccurrences,
  updateEvent,
  upsertRawEvent,
  type EventRow,
} from '@loppefund/db';
import { geocode } from './geocode.ts';

const HORIZON_DAYS = 180;

/**
 * DAWA quality codes that denote a real point rather than a district centroid.
 * 'P' (postcode centroid) and 'C' (uncertain datavask) are approximations that
 * must not be read as precise locations during dedup; 'A'/'B'/'source' are real.
 */
function isPreciseQuality(q: string | null): boolean {
  return q !== 'P' && q !== 'C';
}

// A source below this trust cannot introduce a NEW occurrence date onto an
// event that a more trusted source already describes (it can still refine
// times). Matches the confidence "verified sole source" floor: public
// calendars (>= 0.55) clear it; Facebook (0.4) and tips (0.35) do not.
const DATE_TRUST_FLOOR = 0.5;

export interface CanonicalizeStats {
  created: number;
  merged: number;
  unchanged: number;
  skippedNoDates: number;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Field-wise merge: new value wins only if the field is empty or the new source is more trusted. */
function mergeField<T>(
  current: T | null,
  incoming: T | undefined,
  field: string,
  incomingSource: string,
  provenance: Record<string, string>,
  incomingTrust: number,
  currentTrust: (field: string) => number,
): T | null {
  if (incoming === undefined || incoming === null || incoming === ('' as unknown as T)) {
    return current;
  }
  if (current === null || current === undefined || incomingTrust >= currentTrust(field)) {
    provenance[field] = incomingSource;
    return incoming;
  }
  return current;
}

/**
 * Recompute every active event's confidence from the current state of its
 * source links — this is what makes the freshness decay actually run:
 * a market no source has confirmed lately loses its "godt bekræftet" label
 * long before its dates expire.
 */
export function recomputeConfidence(
  db: DatabaseSync,
  sourceTrust: Record<string, number>,
  today: string,
  confirmations: Record<string, number> = {},
): number {
  const rows = db
    .prepare(
      `SELECT e.id, e.slug, e.lat, e.geocode_quality,
         (SELECT COUNT(DISTINCT r.source_key) FROM event_sources es
          JOIN raw_events r ON r.id = es.raw_event_id WHERE es.event_id = e.id) AS source_count,
         (SELECT MAX(es.last_confirmed_at) FROM event_sources es WHERE es.event_id = e.id) AS last_confirmed,
         (SELECT GROUP_CONCAT(DISTINCT r.source_key) FROM event_sources es
          JOIN raw_events r ON r.id = es.raw_event_id WHERE es.event_id = e.id) AS source_keys,
         EXISTS(SELECT 1 FROM occurrences o WHERE o.event_id = e.id AND o.date >= ?) AS has_dates
       FROM events e WHERE e.status = 'active'`,
    )
    .all(today) as unknown as Array<{
    id: number;
    slug: string;
    lat: number | null;
    geocode_quality: string | null;
    source_count: number;
    last_confirmed: string | null;
    source_keys: string | null;
    has_dates: number;
  }>;
  const upd = db.prepare(`UPDATE events SET confidence = ? WHERE id = ?`);
  let changed = 0;
  for (const r of rows) {
    const daysSince = r.last_confirmed
      ? Math.max(0, (Date.parse(`${today}T00:00:00Z`) - Date.parse(r.last_confirmed)) / 86400000)
      : 365;
    const maxTrust = Math.max(
      0,
      ...(r.source_keys?.split(',') ?? []).map((k) => sourceTrust[k] ?? 0),
    );
    const confidence = computeConfidence({
      maxSourceTrust: maxTrust,
      sourceCount: Math.max(1, r.source_count),
      daysSinceVerified: daysSince,
      hasGoodLocation: r.lat !== null && !['C', 'P'].includes(r.geocode_quality ?? ''),
      hasConcreteDates: r.has_dates === 1,
      communityConfirmations: confirmations[r.slug] ?? 0,
    });
    upd.run(confidence, r.id);
    changed++;
  }
  return changed;
}

/** A canonical event as a dedup MatchCandidate. */
function eventToCandidate(db: DatabaseSync, e: EventRow): MatchCandidate {
  // Ignore a "street" that is merely the town name (a source mis-parse, e.g.
  // "Faaborg" in Faaborg) — so consolidation works on already-stored rows too,
  // not only on freshly re-canonicalized ones. Mirrors the canonicalize cleanup.
  const street =
    e.street && !/\d/.test(e.street) && e.city && normalizeTitle(e.street) === normalizeTitle(e.city)
      ? null
      : e.street;
  return {
    title: e.title,
    lat: e.lat,
    lng: e.lng,
    postcode: e.postcode,
    dates: occurrenceDates(db, e.id),
    category: e.category,
    street,
    coordsPrecise: isPreciseQuality(e.geocode_quality),
  };
}

/** How much identifying information an event carries — the richer row survives a
 *  merge so nothing useful is lost (precise location first, then address parts and
 *  corroboration). Ties break on the lowest id to keep the oldest slug stable. */
function survivorScore(db: DatabaseSync, e: EventRow): number {
  let s = 0;
  if (e.lat != null && isPreciseQuality(e.geocode_quality)) s += 100;
  else if (e.lat != null) s += 20;
  if (e.postcode) s += 10;
  if (e.street) s += 10;
  if (e.venue_name) s += 5;
  if (e.description) s += 3;
  s += Math.min(occurrenceDates(db, e.id).length, 20);
  return s;
}

/** Fold the duplicate event `dropId` into `keepId`: move its occurrences and
 *  source links, then delete it (cascade clears the rest). */
function absorbEvent(db: DatabaseSync, keepId: number, dropId: number): void {
  db.prepare(
    `INSERT OR IGNORE INTO occurrences (event_id, date, start_time, end_time)
     SELECT ?, date, start_time, end_time FROM occurrences WHERE event_id = ?`,
  ).run(keepId, dropId);
  db.prepare(
    `UPDATE OR IGNORE event_sources SET event_id = ? WHERE event_id = ?`,
  ).run(keepId, dropId);
  db.prepare(`DELETE FROM events WHERE id = ?`).run(dropId);
}

/**
 * Consolidate canonical events that are the SAME market but were split into
 * separate rows by ingestion order. Incremental canonicalization links each raw
 * to its single best match, so when a "bridge" raw matches two existing events
 * (it shares a title with one source and a location with another) it joins one
 * and orphans the other — a duplicate that no later raw ever reunites, and that a
 * plain rebuild reproduces. This pass finds those pairs directly: for every event
 * it re-runs the same candidate search + matchEvents used at ingestion and unions
 * matched events, then folds each cluster into its richest member. Conservative by
 * construction — it merges only pairs matchEvents already accepts. Idempotent:
 * a second run finds nothing. Returns the number of events removed by merging.
 */
export function mergeDuplicateEvents(db: DatabaseSync): number {
  const events = db
    .prepare(`SELECT * FROM events WHERE status = 'active'`)
    .all() as unknown as EventRow[];
  const byId = new Map<number, EventRow>(events.map((e) => [e.id, e]));

  // Union-find over event ids.
  const parent = new Map<number, number>(events.map((e) => [e.id, e.id]));
  const find = (x: number): number => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    while (parent.get(x) !== r) {
      const n = parent.get(x)!;
      parent.set(x, r);
      x = n;
    }
    return r;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  for (const e of events) {
    const candidates = findCandidateEvents(db, {
      postcode: e.postcode,
      lat: e.lat,
      lng: e.lng,
      title: e.title,
    });
    const ce = eventToCandidate(db, e);
    for (const c of candidates) {
      // Only union within the active set (findCandidateEvents can surface expired
      // rows, which aren't in the union-find map — never merge an active market
      // into an expired one).
      if (c.id === e.id || !byId.has(c.id) || find(c.id) === find(e.id)) continue;
      const cc = eventToCandidate(db, byId.get(c.id)!);
      // Bidirectional: matchEvents is asymmetric (distinctiveness is read from the
      // first title), so a real duplicate where only ONE side carries the proper
      // token — "Loppemarked på Havnen" vs "Loppemarked Faaborg Havn" — still unites.
      if (matchEvents(ce, cc).isMatch || matchEvents(cc, ce).isMatch) {
        union(e.id, c.id);
      }
    }
  }

  // Group into clusters and fold each into its richest member.
  const clusters = new Map<number, EventRow[]>();
  for (const e of events) {
    const root = find(e.id);
    const list = clusters.get(root) ?? [];
    list.push(e);
    clusters.set(root, list);
  }
  let removed = 0;
  for (const members of clusters.values()) {
    if (members.length < 2) continue;
    const survivor = members.reduce((best, e) => {
      const ds = survivorScore(db, e) - survivorScore(db, best);
      if (ds > 0) return e;
      if (ds === 0 && e.id < best.id) return e;
      return best;
    }, members[0]!);
    if (members.length > 4) {
      console.warn(
        `[consolidate] large cluster of ${members.length} events merged into "${survivor.title}" (#${survivor.id}) — review: ${members.map((m) => m.id).join(',')}`,
      );
    }
    for (const e of members) {
      if (e.id === survivor.id) continue;
      absorbEvent(db, survivor.id, e.id);
      removed++;
    }
  }
  return removed;
}

/**
 * Backfill coordinates onto active events that have none but do carry an address
 * (street/postcode/city). Incremental crawls only geocode an event the moment its
 * raw is (re-)processed, so events created while the geocode cache was poisoned —
 * or before a geocoder improvement — stay pinless on the map forever even though a
 * fresh lookup would resolve them (at least to a postcode centroid). This heals
 * them every run. Purely additive: it only ever fills a NULL coordinate, never
 * overwrites a real one, and fills a missing postcode/town from the result.
 * Returns how many events gained a location.
 */
export async function backfillGeocode(db: DatabaseSync): Promise<number> {
  const rows = db
    .prepare(
      `SELECT id, street, postcode, city FROM events
       WHERE status = 'active' AND lat IS NULL
         AND (postcode IS NOT NULL OR street IS NOT NULL OR city IS NOT NULL)`,
    )
    .all() as unknown as Array<{
    id: number;
    street: string | null;
    postcode: string | null;
    city: string | null;
  }>;
  const upd = db.prepare(
    `UPDATE events
       SET lat = ?, lng = ?, geocode_quality = ?,
           postcode = COALESCE(postcode, ?), city = COALESCE(city, ?)
     WHERE id = ?`,
  );
  let filled = 0;
  for (const r of rows) {
    const g = await geocode(db, {
      street: r.street ?? undefined,
      postcode: r.postcode ?? undefined,
      city: r.city ?? undefined,
    });
    if (g.lat !== null) {
      upd.run(g.lat, g.lng, g.quality, g.resolvedPostcode, g.resolvedCity, r.id);
      filled++;
    }
  }
  return filled;
}

/**
 * Infer indoor/outdoor for active events left 'unknown' by their sources, from
 * the title + venue + description. Most sources never state it (only ~23% did),
 * yet it drives a consumer filter and the rain-cancellation warning. High-
 * precision only (see inferIndoorOutdoor): a wrong "outdoor" would mislead a
 * family, so it fires solely on unambiguous venue words. Returns how many gained
 * a value. Idempotent — only ever fills 'unknown'.
 */
export function backfillIndoorOutdoor(db: DatabaseSync): number {
  const rows = db
    .prepare(
      `SELECT id, title, venue_name, description FROM events
       WHERE status = 'active' AND indoor_outdoor = 'unknown'`,
    )
    .all() as unknown as Array<{
    id: number;
    title: string;
    venue_name: string | null;
    description: string | null;
  }>;
  const upd = db.prepare(`UPDATE events SET indoor_outdoor = ? WHERE id = ?`);
  let filled = 0;
  for (const r of rows) {
    const io = inferIndoorOutdoor(`${r.title} ${r.venue_name ?? ''} ${r.description ?? ''}`);
    if (io !== 'unknown') {
      upd.run(io, r.id);
      filled++;
    }
  }
  return filled;
}

/**
 * Backfill the stall count from free prose ("…med op til 150 stader") for the
 * ~10% of markets that state it in the description but through a source with no
 * dedicated stalls field. Stall count is a strong "worth driving to" and
 * hidden-gem signal. Precision-only (see extractStallCountText): a number must
 * bind to a stall/vendor noun, so a wrong count never lands. Returns the number
 * of events filled.
 */
export function backfillStallCount(db: DatabaseSync): number {
  const rows = db
    .prepare(
      `SELECT id, title, description FROM events
       WHERE status = 'active' AND stall_count_text IS NULL`,
    )
    .all() as unknown as Array<{ id: number; title: string; description: string | null }>;
  const upd = db.prepare(`UPDATE events SET stall_count_text = ? WHERE id = ?`);
  let filled = 0;
  for (const r of rows) {
    const stalls = extractStallCountText(`${r.title} ${r.description ?? ''}`);
    if (stalls) {
      upd.run(stalls, r.id);
      filled++;
    }
  }
  return filled;
}

/**
 * Backfill free/paid ENTRY from the description for markets whose source left
 * the fee blank — "is it free?" is one of the first things a family asks. Only
 * unambiguous, non-contradictory signals are used (see inferIsFreeFromText): a
 * wrong "Gratis" badge is the kind of incorrectness the product must never
 * show, so anything unclear stays unknown. Returns the number of events filled.
 */
export function backfillIsFree(db: DatabaseSync): number {
  const rows = db
    .prepare(
      `SELECT id, title, description FROM events
       WHERE status = 'active' AND is_free IS NULL`,
    )
    .all() as unknown as Array<{ id: number; title: string; description: string | null }>;
  const upd = db.prepare(`UPDATE events SET is_free = ? WHERE id = ?`);
  let filled = 0;
  for (const r of rows) {
    const free = inferIsFreeFromText(`${r.title} ${r.description ?? ''}`);
    if (free !== null) {
      upd.run(free ? 1 : 0, r.id);
      filled++;
    }
  }
  return filled;
}

export async function canonicalizeRawEvent(
  db: DatabaseSync,
  raw: RawEvent,
  sourceTrust: Record<string, number>,
  stats: CanonicalizeStats,
  opts: {
    touch?: boolean;
    /**
     * (sourceKey:sourceEventId -> slug) captured before a rebuild, so
     * published URLs stay stable when canonical events are re-derived.
     */
    slugHints?: Map<string, string>;
  } = {},
): Promise<void> {
  const { id: rawId, changed } = upsertRawEvent(db, raw, opts);
  const trust = sourceTrust[raw.sourceKey] ?? 0.5;
  const now = new Date().toISOString();

  // Seasonal override: a title that says jule is a julemarked no matter how
  // the source categorized it — this feeds the julemarked dedup veto, so it
  // must be applied consistently at canonicalization time.
  const rawCategory =
    normalizeCategory(raw.title) === 'julemarked' ? 'julemarked' : raw.category;

  // A recurring market must not bake one occurrence's date into its name — it
  // reads wrong next to the other dates and splits the market into un-mergeable
  // per-date records. Clean the title up front so dedup, slug and display all
  // use the stable name.
  const title = stripDateTokens(raw.title);
  const venueName = cleanVenueName(raw.venueName);
  // Drop vague-locality "streets" ("Byens gader") up front so geocoding, dedup
  // and display all use a real address or nothing — never a placeholder.
  let street = cleanStreet(raw.street);

  // Resolve concrete occurrences. Events we cannot date are not shown to
  // consumers — a market without a date is a rumor, not an event.
  const occurrences = resolveSchedule(
    {
      dateRanges: raw.dateRanges,
      scheduleText: raw.scheduleText,
      openingHoursText: raw.openingHoursText,
    },
    { from: today(), horizonDays: HORIZON_DAYS },
  );
  if (raw.occurrences) {
    for (const o of raw.occurrences) {
      if (o.date >= today() && !occurrences.some((x) => x.date === o.date)) {
        occurrences.push(o);
      }
    }
    occurrences.sort((a, b) => a.date.localeCompare(b.date));
  }
  if (occurrences.length === 0) {
    stats.skippedNoDates++;
    return;
  }

  // Geocode when the source didn't provide coordinates.
  let lat = raw.lat ?? null;
  let lng = raw.lng ?? null;
  let geocodeQuality: string | null = raw.lat != null ? 'source' : null;
  let postcode = raw.postcode ?? null;
  let city = raw.city ?? null;
  if (lat === null && (street || raw.postcode)) {
    const g = await geocode(db, {
      street: street ?? undefined,
      postcode: raw.postcode,
      city: raw.city,
    });
    lat = g.lat;
    lng = g.lng;
    geocodeQuality = g.quality;
    postcode = postcode ?? g.resolvedPostcode;
    city = city ?? g.resolvedCity;
  }
  // Some adapters leak "street, postcode city" (sometimes repeated) into city;
  // clean it to a plain town name so both the location line and the slug are right.
  city = cleanCity(city, postcode);

  // A "street" that is merely the town name with no house number ("Faaborg" as the
  // street in Faaborg) is a source mis-parse, not an address — it geocodes to the
  // postcode centroid and, worse, triggers a false "different streets" dedup veto
  // against the same market listed with a real street by another source. Drop it
  // now (after geocoding used it to resolve the town) comparing against the
  // resolved city, since such sources often omit an explicit city field.
  if (
    street &&
    !/\d/.test(street) &&
    ((city && normalizeTitle(street) === normalizeTitle(city)) ||
      (raw.city && normalizeTitle(street) === normalizeTitle(raw.city)))
  ) {
    street = null;
  }

  // Find the canonical event this raw event belongs to.
  const candidates = findCandidateEvents(db, { postcode, lat, lng, title });
  const rawDates = occurrences.map((o) => o.date);
  let best: { event: EventRow; score: number } | null = null;
  for (const candidate of candidates) {
    const result = matchEvents(
      {
        title,
        lat,
        lng,
        postcode,
        dates: rawDates,
        category: rawCategory,
        street,
        coordsPrecise: isPreciseQuality(geocodeQuality),
      },
      {
        title: candidate.title,
        lat: candidate.lat,
        lng: candidate.lng,
        postcode: candidate.postcode,
        dates: occurrenceDates(db, candidate.id),
        category: candidate.category,
        street: candidate.street,
        coordsPrecise: isPreciseQuality(candidate.geocode_quality),
      },
    );
    if (result.isMatch && (best === null || result.score > best.score)) {
      best = { event: candidate, score: result.score };
    }
  }

  const cancelled = raw.cancelled === true;

  if (best) {
    const e = best.event;
    // Re-linking the same raw event with unchanged payload only bumps freshness.
    linkEventSource(db, e.id, rawId);
    const provenance = JSON.parse(e.field_provenance) as Record<string, string>;
    const currentTrust = (field: string) =>
      sourceTrust[provenance[field] ?? ''] ?? 0;
    const m = <T>(cur: T | null, inc: T | undefined, field: string) =>
      mergeField(cur, inc, field, raw.sourceKey, provenance, trust, currentTrust);

    const contributing = db
      .prepare(
        `SELECT DISTINCT r.source_key k FROM event_sources es
         JOIN raw_events r ON r.id = es.raw_event_id WHERE es.event_id = ?`,
      )
      .all(e.id) as unknown as Array<{ k: string }>;
    const sourceCount = contributing.length;
    const maxContributingTrust = Math.max(
      trust,
      ...contributing.map((s) => sourceTrust[s.k] ?? 0),
    );

    // Cancellation policy (asymmetric on purpose):
    // - Flipping to cancelled requires meaningful trust — a mis-parsed
    //   low-trust tip must never cancel a corroborated market. A source can
    //   always cancel an event it dominates itself.
    // - Restoring to active is stricter: only the dominant source, and only
    //   when its listing actually changed (organizer re-published). A wrong
    //   "cancelled" costs a missed trip; a wrong "active" sends a family to
    //   a closed venue.
    const cancelThreshold = Math.min(0.5, maxContributingTrust);
    let status = e.status as 'active' | 'cancelled' | 'expired';
    if (cancelled && trust >= cancelThreshold) {
      status = 'cancelled';
    } else if (!cancelled && status === 'cancelled' && trust >= maxContributingTrust && changed) {
      status = 'active';
    } else if (status === 'expired') {
      status = 'active';
    }

    // Location merges atomically by geocode-quality rank: approximate
    // postcode centroids must never overwrite exact source coordinates,
    // regardless of source trust.
    const qualityRank = (q: string | null) =>
      q === 'source' ? 3 : q === 'A' ? 2 : q === 'B' ? 1 : 0;
    let mergedLat = e.lat;
    let mergedLng = e.lng;
    let mergedQuality = e.geocode_quality;
    if (
      lat !== null &&
      (e.lat === null ||
        qualityRank(geocodeQuality) > qualityRank(e.geocode_quality) ||
        (qualityRank(geocodeQuality) === qualityRank(e.geocode_quality) &&
          trust >= currentTrust('lat')))
    ) {
      mergedLat = lat;
      mergedLng = lng;
      mergedQuality = geocodeQuality;
      provenance.lat = raw.sourceKey;
      provenance.lng = raw.sourceKey;
      provenance.geocodeQuality = raw.sourceKey;
    }

    // Incoming title is already date-stripped; still guard against replacing a
    // clean canonical title with a residual dated one from older data.
    const incomingTitle =
      titleHasDateTokens(title) && !titleHasDateTokens(e.title) ? undefined : title;

    const merged = {
      slug: e.slug,
      title: m(e.title, incomingTitle, 'title') ?? e.title,
      description: m(e.description, raw.description, 'description'),
      // 'andet' is a sentinel, not information — mirror indoorOutdoor.
      category: (m(
        e.category === 'andet' ? null : e.category,
        rawCategory === 'andet' ? undefined : rawCategory,
        'category',
      ) ?? 'andet') as ReturnType<typeof normalizeCategory>,
      venueName: m(e.venue_name, venueName ?? undefined, 'venueName'),
      street: m(e.street, street ?? undefined, 'street'),
      postcode: m(e.postcode, postcode ?? undefined, 'postcode'),
      city: m(e.city, city ?? undefined, 'city'),
      municipality: m(e.municipality, raw.municipality, 'municipality'),
      lat: mergedLat,
      lng: mergedLng,
      geocodeQuality: mergedQuality,
      organizer: m(e.organizer, raw.organizer, 'organizer'),
      contactWebsite: m(e.contact_website, raw.contactWebsite, 'contactWebsite'),
      contactEmail: m(e.contact_email, raw.contactEmail, 'contactEmail'),
      contactPhone: m(e.contact_phone, raw.contactPhone, 'contactPhone'),
      priceText: m(e.price_text, raw.priceText, 'priceText'),
      isFree: m(e.is_free === null ? null : e.is_free === 1, raw.isFree, 'isFree'),
      stallCountText: m(e.stall_count_text, raw.stallCountText, 'stallCountText'),
      indoorOutdoor: (m(
        e.indoor_outdoor === 'unknown' ? null : e.indoor_outdoor,
        raw.indoorOutdoor === 'unknown' ? undefined : raw.indoorOutdoor,
        'indoorOutdoor',
      ) ?? 'unknown') as IndoorOutdoor,
      scheduleText: m(e.schedule_text, raw.scheduleText, 'scheduleText'),
      openingHoursText: m(e.opening_hours_text, raw.openingHoursText, 'openingHoursText'),
      status,
      confidence: 0,
      fieldProvenance: provenance,
      firstSeenAt: e.first_seen_at,
      lastSeenAt: now,
    };
    // Amenities always derive from the canonical description on display,
    // so recompute from whatever description won the merge.
    const mergedAmenities = merged.description
      ? JSON.stringify(extractAmenities(merged.description))
      : null;
    merged.confidence = computeConfidence({
      maxSourceTrust: Math.max(trust, ...Object.keys(provenance).map((f) => currentTrust(f))),
      sourceCount,
      daysSinceVerified: 0,
      // Postcode-centroid ("P") locations are approximate — not "good".
      hasGoodLocation: merged.lat !== null && !['C', 'P'].includes(merged.geocodeQuality ?? ''),
      hasConcreteDates: occurrences.length > 0,
    });
    updateEvent(db, e.id, { ...merged, amenities: mergedAmenities });

    // Occurrences re-derive from ALL linked raw payloads, so a date a source
    // retracted disappears and reschedules take effect. Per date, the
    // highest-trust source with known times wins.
    const linkedPayloads = db
      .prepare(
        `SELECT r.payload, r.source_key FROM event_sources es
         JOIN raw_events r ON r.id = es.raw_event_id WHERE es.event_id = ?`,
      )
      .all(e.id) as unknown as Array<{ payload: string; source_key: string }>;
    // Per date, track the winning occurrence (whose TIMES win) AND the highest
    // trust of any source that ASSERTS that date. `occTrust` gates times;
    // `dateTrust` gates whether the date is allowed to exist at all.
    const byDate = new Map<
      string,
      { occ: Occurrence; occTrust: number; dateTrust: number }
    >();
    const maxTrust = Math.max(
      0,
      ...linkedPayloads.map((lp) => sourceTrust[lp.source_key] ?? 0.5),
    );
    for (const lp of linkedPayloads) {
      const p = JSON.parse(lp.payload) as RawEvent;
      const lpTrust = sourceTrust[lp.source_key] ?? 0.5;
      const occs = resolveSchedule(
        {
          dateRanges: p.dateRanges,
          scheduleText: p.scheduleText,
          openingHoursText: p.openingHoursText,
        },
        { from: today(), horizonDays: HORIZON_DAYS },
      );
      if (p.occurrences) {
        for (const o of p.occurrences) {
          if (o.date >= today() && !occs.some((x) => x.date === o.date)) occs.push(o);
        }
      }
      for (const o of occs) {
        const prior = byDate.get(o.date);
        const better =
          !prior ||
          (o.startTime !== null && prior.occ.startTime === null) ||
          (o.startTime !== null && prior.occ.startTime !== null && lpTrust > prior.occTrust);
        byDate.set(o.date, {
          occ: better ? o : prior!.occ,
          occTrust: better ? lpTrust : prior!.occTrust,
          dateTrust: Math.max(prior?.dateTrust ?? 0, lpTrust),
        });
      }
    }
    // A low-trust source must not INVENT event days on an event that a more
    // trusted source describes: a family would travel on a day the market
    // isn't held. A date is admitted only if a source at least as trusted as
    // the DATE_TRUST_FLOOR (or, when no trusted source touches this event at
    // all, the best source present) asserts it. Low-trust sources may still
    // refine TIMES on dates a trusted source already asserts (occTrust logic
    // above) — they just can't conjure new dates. "Missing over incorrect."
    const admitFloor = Math.min(maxTrust, DATE_TRUST_FLOOR);
    replaceOccurrences(
      db,
      e.id,
      [...byDate.values()]
        .filter((v) => v.dateTrust >= admitFloor)
        .map((v) => v.occ)
        .sort((a, b) => a.date.localeCompare(b.date)),
    );
    if (changed) stats.merged++;
    else stats.unchanged++;
    return;
  }

  // New canonical event.
  const provenance: Record<string, string> = {};
  for (const f of Object.keys(raw)) provenance[f] = raw.sourceKey;
  // Published URLs must survive rebuilds: reuse the slug this raw event's
  // canonical had before, falling back to a fresh deterministic one.
  const hinted = opts.slugHints?.get(`${raw.sourceKey}:${raw.sourceEventId}`);
  const baseSlug =
    hinted && !db.prepare(`SELECT 1 FROM events WHERE slug = ?`).get(hinted)
      ? hinted
      : slugify(`${title} ${city ?? raw.municipality ?? ''}`);
  let slug = baseSlug;
  for (let i = 2; db.prepare(`SELECT 1 FROM events WHERE slug = ?`).get(slug); i++) {
    slug = `${baseSlug}-${i}`;
  }
  const id = insertEvent(db, {
    slug,
    title,
    description: raw.description ?? null,
    category: rawCategory ?? 'andet',
    venueName,
    street,
    postcode,
    city,
    municipality: raw.municipality ?? null,
    lat,
    lng,
    geocodeQuality,
    organizer: raw.organizer ?? null,
    contactWebsite: raw.contactWebsite ?? null,
    contactEmail: raw.contactEmail ?? null,
    contactPhone: raw.contactPhone ?? null,
    priceText: raw.priceText ?? null,
    isFree: raw.isFree ?? null,
    stallCountText: raw.stallCountText ?? null,
    indoorOutdoor: raw.indoorOutdoor ?? 'unknown',
    scheduleText: raw.scheduleText ?? null,
    openingHoursText: raw.openingHoursText ?? null,
    status: cancelled ? 'cancelled' : 'active',
    confidence: computeConfidence({
      maxSourceTrust: trust,
      sourceCount: 1,
      daysSinceVerified: 0,
      hasGoodLocation: lat !== null && !['C', 'P'].includes(geocodeQuality ?? ''),
      hasConcreteDates: true,
    }),
    fieldProvenance: provenance,
    firstSeenAt: now,
    lastSeenAt: now,
    amenities: raw.description ? JSON.stringify(extractAmenities(raw.description)) : null,
  });
  replaceOccurrences(db, id, occurrences);
  linkEventSource(db, id, rawId);
  stats.created++;
}
