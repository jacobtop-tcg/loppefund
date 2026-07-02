/**
 * Canonicalization: turn RawEvents into canonical events with dedup,
 * field-level provenance, occurrence materialization and confidence.
 */
import type { DatabaseSync } from 'node:sqlite';
import {
  computeConfidence,
  extractAmenities,
  matchEvents,
  normalizeCategory,
  resolveSchedule,
  slugify,
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
): number {
  const rows = db
    .prepare(
      `SELECT e.id, e.lat, e.geocode_quality,
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
    });
    upd.run(confidence, r.id);
    changed++;
  }
  return changed;
}

export async function canonicalizeRawEvent(
  db: DatabaseSync,
  raw: RawEvent,
  sourceTrust: Record<string, number>,
  stats: CanonicalizeStats,
  opts: { touch?: boolean } = {},
): Promise<void> {
  const { id: rawId, changed } = upsertRawEvent(db, raw, opts);
  const trust = sourceTrust[raw.sourceKey] ?? 0.5;
  const now = new Date().toISOString();

  // Seasonal override: a title that says jule is a julemarked no matter how
  // the source categorized it — this feeds the julemarked dedup veto, so it
  // must be applied consistently at canonicalization time.
  const rawCategory =
    normalizeCategory(raw.title) === 'julemarked' ? 'julemarked' : raw.category;

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
  if (lat === null && (raw.street || raw.postcode)) {
    const g = await geocode(db, {
      street: raw.street,
      postcode: raw.postcode,
      city: raw.city,
    });
    lat = g.lat;
    lng = g.lng;
    geocodeQuality = g.quality;
    postcode = postcode ?? g.resolvedPostcode;
    city = city ?? g.resolvedCity;
  }

  // Find the canonical event this raw event belongs to.
  const candidates = findCandidateEvents(db, { postcode, lat, lng, title: raw.title });
  const rawDates = occurrences.map((o) => o.date);
  let best: { event: EventRow; score: number } | null = null;
  for (const candidate of candidates) {
    const result = matchEvents(
      {
        title: raw.title,
        lat,
        lng,
        postcode,
        dates: rawDates,
        category: rawCategory,
        street: raw.street,
      },
      {
        title: candidate.title,
        lat: candidate.lat,
        lng: candidate.lng,
        postcode: candidate.postcode,
        dates: occurrenceDates(db, candidate.id),
        category: candidate.category,
        street: candidate.street,
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

    // Per-date series titles ("Loppemarked lørdag d. 5. juli") must not
    // replace a clean canonical title.
    const incomingTitle =
      titleHasDateTokens(raw.title) && !titleHasDateTokens(e.title)
        ? undefined
        : raw.title;

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
      venueName: m(e.venue_name, raw.venueName, 'venueName'),
      street: m(e.street, raw.street, 'street'),
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
    const byDate = new Map<string, { occ: Occurrence; trust: number }>();
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
          (o.startTime !== null && prior.occ.startTime !== null && lpTrust > prior.trust);
        if (better) byDate.set(o.date, { occ: o, trust: lpTrust });
      }
    }
    replaceOccurrences(
      db,
      e.id,
      [...byDate.values()].map((v) => v.occ).sort((a, b) => a.date.localeCompare(b.date)),
    );
    if (changed) stats.merged++;
    else stats.unchanged++;
    return;
  }

  // New canonical event.
  const provenance: Record<string, string> = {};
  for (const f of Object.keys(raw)) provenance[f] = raw.sourceKey;
  const baseSlug = slugify(`${raw.title} ${city ?? raw.municipality ?? ''}`);
  let slug = baseSlug;
  for (let i = 2; db.prepare(`SELECT 1 FROM events WHERE slug = ?`).get(slug); i++) {
    slug = `${baseSlug}-${i}`;
  }
  const id = insertEvent(db, {
    slug,
    title: raw.title,
    description: raw.description ?? null,
    category: rawCategory ?? 'andet',
    venueName: raw.venueName ?? null,
    street: raw.street ?? null,
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
