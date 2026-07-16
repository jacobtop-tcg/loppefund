/**
 * INGEST for informal places.
 *
 * The only write path is an OPERATOR-VETTED file: data/informal-places.json.
 * That is not a shortcut — it is the architecture. The site is a static export
 * with no backend, so nothing user-submitted can reach the database on its own;
 * every existing community bridge (confirmations.json, venue-hours.json,
 * reviews.json, photos.json) works exactly this way: form → inbox → a human
 * vets it → a committed JSON → the crawl applies it.
 *
 * For informal places that human gate is not a limitation to route around, it
 * is the product promise. These records point at private people's homes. A
 * scraped Facebook post is a *lead*, never a publication — so a lead lands in
 * the review queue, and only a vetted entry becomes a place.
 *
 * Scores are computed HERE, in the build, and stored — never in the browser
 * (the analysis was explicit: informal_place confidence must be baked, like
 * events.confidence, so the client only ever reads it).
 */
import type { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync } from 'node:fs';
import {
  computeFundScore,
  computeInformalConfidence,
  matchInformalPlaces,
  normalizePhone,
  type AddressVisibility,
  type InformalPlaceStatus,
  type InformalPlaceType,
  type InformalSourceRecord,
  type InformalVisitReport,
  type InventorySignal,
  type PriceLevel,
} from '@loppefund/core';
import {
  addInformalReport,
  addInformalSource,
  listInformalPlaces,
  upsertInformalPlace,
} from '@loppefund/db';

/** One vetted entry in data/informal-places.json. Deliberately close to what a
 *  human can actually write by hand after reading a tip. */
export interface VettedInformalPlace {
  slug: string;
  name: string;
  /**
   * Other names the place goes by ("Loppeladen", "Laden hos Ruth").
   *
   * The column existed and entity resolution already read it — but nothing ever
   * wrote it, so it was always `[]` and alias matching was dead weight. Worse,
   * `aliases=excluded.aliases` sits in the upsert's ON CONFLICT, so anything a
   * human typed straight into the DB was erased on the next run: the same
   * data-destroying shape as the Facebook harvest bug in 38d4d71. The vetted
   * file is the only write path, so the field belongs here.
   */
  aliases?: string[];
  placeType: InformalPlaceType;
  /** Cautious default — an entry MUST opt in to a full address. */
  addressVisibility?: AddressVisibility;
  description?: string;
  street?: string;
  postcode?: string;
  city?: string;
  municipality?: string;
  region?: string;
  lat?: number;
  lng?: number;
  geoPrecision?: 'exact' | 'street' | 'postcode' | 'area' | 'unknown';
  contactName?: string;
  phone?: string;
  email?: string;
  facebookUrl?: string;
  websiteUrl?: string;
  status?: InformalPlaceStatus;
  openingNotes?: string;
  recurrence?: { weekdays?: number[]; pattern?: string; season?: [string, string]; notes?: string };
  callBeforeVisiting?: boolean;
  openWhenFlagIsOut?: boolean;
  priceLevel?: PriceLevel;
  inventorySignals?: InventorySignal[];
  imageUrls?: string[];
  moderationNotes?: string;
  /** Distance to the nearest large town, when the operator knows it. */
  kmToLargeCity?: number;
  /** Flags the operator sets from reading the sources — things no rule can infer. */
  flags?: Record<string, boolean>;
  sources?: Array<{
    sourceType: InformalSourceRecord['sourceType'];
    url?: string;
    observedAt: string;
    excerpt?: string;
    verifiedBy?: string;
  }>;
  visits?: Array<Partial<InformalVisitReport> & { visitedAt: string }>;
}

export interface InformalIngestStats {
  vetted: number;
  upserted: number;
  skipped: number;
  mergeSuggestions: number;
}

/** Read the operator-vetted file. Absent/broken = no places, never a throw:
 *  a missing community file must not break a crawl. */
export function loadVettedPlaces(path: string): VettedInformalPlace[] {
  // SAY SO. Returning [] quietly is what let this whole feature never run and
  // nobody notice: the command exited 0, printed "0 vetted", and looked like a
  // clean pass. A missing file must still not break a crawl — but silence about
  // it is how a feature stays at zero rows for weeks while looking healthy.
  if (!existsSync(path)) {
    console.warn(`informal-places: no vetted file at ${path} — nothing to ingest.`);
    return [];
  }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    if (!Array.isArray(parsed)) {
      console.warn(`informal-places: ${path} is not a JSON array — ignoring it.`);
      return [];
    }
    const ok = parsed.filter(
      (p): p is VettedInformalPlace =>
        !!p && typeof (p as VettedInformalPlace).slug === 'string' &&
        typeof (p as VettedInformalPlace).name === 'string',
    );
    if (ok.length < parsed.length) {
      console.warn(
        `informal-places: ${parsed.length - ok.length} of ${parsed.length} entries lack a slug/name — skipped.`,
      );
    }
    return ok;
  } catch (err) {
    // A broken file is an operator mistake worth shouting about, not a no-op.
    console.warn(`informal-places: could not read ${path} — ${(err as Error).message}`);
    return [];
  }
}

/**
 * Ingest the vetted places: store them, then compute and store BOTH scores.
 *
 * Note the order — the record is written first, then scored from what is
 * actually stored (its real sources and reports), so a score can never describe
 * data that isn't there.
 */
export function ingestInformalPlaces(
  db: DatabaseSync,
  vetted: VettedInformalPlace[],
  today: string,
): InformalIngestStats {
  const stats: InformalIngestStats = { vetted: vetted.length, upserted: 0, skipped: 0, mergeSuggestions: 0 };

  for (const v of vetted) {
    // A place with no location at all cannot be shown or trusted — missing over
    // incorrect, so it is skipped rather than pinned at a guess.
    if (!v.city && !v.postcode && v.lat == null) {
      stats.skipped++;
      continue;
    }

    const sources: InformalSourceRecord[] = (v.sources ?? []).map((s) => ({
      sourceType: s.sourceType,
      url: s.url ?? null,
      observedAt: s.observedAt,
      excerpt: s.excerpt ?? null,
      verifiedBy: s.verifiedBy ?? null,
    }));
    const visits: InformalVisitReport[] = (v.visits ?? []).map((r) => ({
      visitedAt: r.visitedAt,
      wasOpen: r.wasOpen ?? null,
      priceLevel: r.priceLevel ?? null,
      stockLevel: r.stockLevel ?? null,
      freshStock: r.freshStock ?? null,
      sellerKind: r.sellerKind ?? null,
      negotiable: r.negotiable ?? null,
      categories: r.categories ?? [],
      worthTheDrive: r.worthTheDrive ?? null,
      comment: r.comment ?? null,
      reporter: r.reporter ?? null,
      reportedClosed: r.reportedClosed ?? false,
    }));

    const observed = sources.map((s) => s.observedAt).sort();
    const firstSeenAt = observed[0] ?? today;
    const lastSeenAt = observed[observed.length - 1] ?? today;
    const lastVerifiedAt =
      sources
        .filter((s) => s.sourceType === 'phone_verification' || s.sourceType === 'user_visit' || s.sourceType === 'operator_review')
        .map((s) => s.observedAt)
        .sort()
        .pop() ?? null;

    const recurrence = v.recurrence
      ? {
          weekdays: v.recurrence.weekdays ?? [],
          pattern: v.recurrence.pattern ?? null,
          season: v.recurrence.season ?? null,
          notes: v.recurrence.notes ?? null,
        }
      : null;

    const conf = computeInformalConfidence(
      {
        sources,
        visitReports: visits,
        street: v.street ?? null,
        phone: v.phone ?? null,
        lat: v.lat ?? null,
        lng: v.lng ?? null,
        geoPrecision: v.geoPrecision ?? 'unknown',
        recurrence,
        openingNotes: v.openingNotes ?? null,
        imageUrls: v.imageUrls ?? [],
        lastSeenAt,
        lastVerifiedAt,
        flags: v.flags ?? {},
      },
      today,
    );
    const fund = computeFundScore({
      placeType: v.placeType,
      inventorySignals: v.inventorySignals ?? [],
      priceLevel: v.priceLevel ?? null,
      visitReports: visits,
      websiteUrl: v.websiteUrl ?? null,
      facebookUrl: v.facebookUrl ?? null,
      kmToLargeCity: v.kmToLargeCity ?? null,
      status: v.status ?? 'unverified',
      sourceCount: sources.length,
      flags: v.flags ?? {},
    });

    const id = upsertInformalPlace(db, {
      slug: v.slug,
      canonicalName: v.name,
      aliases: v.aliases,
      placeType: v.placeType,
      description: v.description ?? null,
      street: v.street ?? null,
      postcode: v.postcode ?? null,
      city: v.city ?? null,
      municipality: v.municipality ?? null,
      region: v.region ?? null,
      lat: v.lat ?? null,
      lng: v.lng ?? null,
      geoPrecision: v.geoPrecision ?? 'unknown',
      // The cautious default is deliberate: an entry must OPT IN to a full
      // address, never inherit one by omission.
      addressVisibility: v.addressVisibility ?? 'omraade',
      contactName: v.contactName ?? null,
      phone: v.phone ?? null,
      phoneNorm: normalizePhone(v.phone ?? null),
      email: v.email ?? null,
      facebookUrl: v.facebookUrl ?? null,
      websiteUrl: v.websiteUrl ?? null,
      firstSeenAt,
      lastSeenAt,
      lastVerifiedAt,
      status: v.status ?? 'unverified',
      recurrence: recurrence ? JSON.stringify(recurrence) : null,
      openingNotes: v.openingNotes ?? null,
      callBeforeVisiting: v.callBeforeVisiting ?? false,
      openWhenFlagIsOut: v.openWhenFlagIsOut ?? false,
      confidence: conf.score,
      fundScore: fund.score,
      scoreFlags: JSON.stringify(v.flags ?? {}),
      priceLevel: v.priceLevel ?? null,
      inventorySignals: v.inventorySignals ?? [],
      imageUrls: v.imageUrls ?? [],
      moderationNotes: v.moderationNotes ?? null,
    });

    for (const s of v.sources ?? []) {
      addInformalSource(db, id, {
        sourceType: s.sourceType,
        url: s.url ?? null,
        observedAt: s.observedAt,
        excerpt: s.excerpt ?? null,
        verifiedBy: s.verifiedBy ?? null,
      });
    }
    // Reports are replaced wholesale so the vetted file stays the source of
    // truth (re-running must be idempotent, not additive).
    db.prepare(`DELETE FROM informal_place_reports WHERE place_id = ?`).run(id);
    for (const r of visits) addInformalReport(db, id, r);

    stats.upserted++;
  }

  stats.mergeSuggestions = findMergeSuggestions(db).length;
  return stats;
}

export interface MergeSuggestion {
  a: string;
  b: string;
  verdict: 'merge' | 'review';
  score: number;
  reasons: string[];
}

/**
 * Cross-compare stored places and report likely duplicates.
 *
 * This only ever REPORTS — it never merges automatically, even on a 'merge'
 * verdict. Folding two records together is destructive and, for private
 * sellers, potentially harmful; a human confirms. (matchInformalPlaces is
 * already strict: only a shared phone or Facebook identity can reach 'merge'.)
 */
export function findMergeSuggestions(db: DatabaseSync): MergeSuggestion[] {
  const rows = listInformalPlaces(db);
  const out: MergeSuggestion[] = [];
  const asCandidate = (r: (typeof rows)[number]) => ({
    canonicalName: r.canonical_name,
    aliases: JSON.parse(r.aliases) as string[],
    placeType: r.place_type as InformalPlaceType,
    street: r.street,
    city: r.city,
    lat: r.lat,
    lng: r.lng,
    phone: r.phone,
    facebookUrl: r.facebook_url,
    contactName: r.contact_name,
    recurrence: r.recurrence ? JSON.parse(r.recurrence) : null,
  });
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const m = matchInformalPlaces(
        asCandidate(rows[i]!) as never,
        asCandidate(rows[j]!) as never,
      );
      if (m.verdict !== 'distinct') {
        out.push({
          a: rows[i]!.slug,
          b: rows[j]!.slug,
          verdict: m.verdict,
          score: m.score,
          reasons: m.reasons,
        });
      }
    }
  }
  return out;
}
