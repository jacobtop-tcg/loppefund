/**
 * Pipeline CLI:
 *   node packages/pipeline/src/cli.ts run [--source key] [--limit N] [--db path]
 *   node packages/pipeline/src/cli.ts rebuild [--db path]
 *   node packages/pipeline/src/cli.ts stats [--db path]
 *   node packages/pipeline/src/cli.ts discover-sources [--probe-limit N] [--min-mentions N]
 *       [--json] [--promote domain | --reject domain [--note text]]
 */
import { parseArgs } from 'node:util';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { normalizeTitle } from '@loppefund/core';
import type { RawEvent } from '@loppefund/core';
import {
  anyLinkedPayload,
  expirePastEvents,
  finishRun,
  listSourceCandidates,
  markCandidateProbed,
  openDb,
  recordDocument,
  reconcileVanishedSourceEvents,
  setCandidateStatus,
  startRun,
  upsertSource,
  upsertSourceCandidate,
  hashContent,
} from '@loppefund/db';
import { PoliteFetcher } from './fetcher.ts';
import {
  backfillGeocode,
  backfillIndoorOutdoor,
  backfillIsFree,
  backfillStallCount,
  canonicalizeRawEvent,
  mergeDuplicateEvents,
  recomputeConfidence,
  type CanonicalizeStats,
} from './canonicalize.ts';
import { formatReport, mineDomains, netNewCandidates, probeDomain } from './discovery.ts';
import { parseTip } from './tip-parser.ts';
import { ingestOsmVenues } from './venues.ts';
import { ingestChainVenues } from './chain-venues.ts';
import { fetchKirkensKorshaerVenues } from './adapters/kirkenskorshaer.ts';
import { fetchFolkekirkensNoedhjaelpVenues } from './adapters/folkekirkensnoedhjaelp.ts';
import { fetchRodekorsVenues } from './adapters/rodekors.ts';
import { geocode } from './geocode.ts';
import { adapters } from './adapters/index.ts';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    source: { type: 'string' },
    limit: { type: 'string' },
    db: { type: 'string', default: 'data/loppefund.db' },
    'probe-limit': { type: 'string' },
    'min-mentions': { type: 'string' },
    json: { type: 'boolean', default: false },
    promote: { type: 'string' },
    reject: { type: 'string' },
    note: { type: 'string' },
  },
});

/**
 * Community confirmations: a committed {slug: count} map (data/confirmations.json,
 * alongside the db) that bridges the "Bekræft marked" taps — collected via the
 * form inbox — into the trust model. Empty by default; a quorum of confirmations
 * corroborates an otherwise-uncorroborated low-trust market (see computeConfidence).
 */
function loadConfirmations(dbPath: string): Record<string, number> {
  const file = join(dirname(dbPath), 'confirmations.json');
  if (!existsSync(file)) return {};
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    const out: Record<string, number> = {};
    for (const [slug, v] of Object.entries(parsed)) {
      const n = typeof v === 'number' ? v : Number((v as { count?: number } | null)?.count);
      if (Number.isFinite(n) && n > 0) out[slug] = Math.floor(n);
    }
    return out;
  } catch {
    return {};
  }
}
const confirmations = loadConfirmations(values.db);

const command = positionals[0] ?? 'run';
const db = openDb(values.db!);

if (command === 'stats') {
  const q = (sql: string) => (db.prepare(sql).get() as { c: number }).c;
  console.log('events (active):   ', q(`SELECT COUNT(*) c FROM events WHERE status='active'`));
  console.log('events (cancelled):', q(`SELECT COUNT(*) c FROM events WHERE status='cancelled'`));
  console.log('events (expired):  ', q(`SELECT COUNT(*) c FROM events WHERE status='expired'`));
  console.log('occurrences:       ', q(`SELECT COUNT(*) c FROM occurrences`));
  console.log('raw events:        ', q(`SELECT COUNT(*) c FROM raw_events`));
  console.log('geocode cache:     ', q(`SELECT COUNT(*) c FROM geocode_cache`));
  console.log('tips (nye):        ', q(`SELECT COUNT(*) c FROM tips WHERE status='new'`));
  const runs = db
    .prepare(`SELECT source_key, started_at, finished_at, stats FROM pipeline_runs ORDER BY id DESC LIMIT 5`)
    .all();
  console.log('recent runs:', JSON.stringify(runs, null, 1));
  process.exit(0);
}

if (command === 'rebuild') {
  // Re-derive all canonical events from the immutable raw layer.
  // Geocode cache persists, so this is offline-fast and reproducible.
  console.log('rebuilding canonical events from raw layer…');
  // Snapshot slugs so published /marked/ URLs survive the re-derivation.
  const slugHints = new Map<string, string>(
    (
      db.prepare(
        `SELECT r.source_key || ':' || r.source_event_id AS k, e.slug AS s
         FROM event_sources es
         JOIN raw_events r ON r.id = es.raw_event_id
         JOIN events e ON e.id = es.event_id`,
      ).all() as unknown as Array<{ k: string; s: string }>
    ).map((r) => [r.k, r.s]),
  );
  db.exec('DELETE FROM event_sources; DELETE FROM occurrences; DELETE FROM events;');
  const trustRows = Object.fromEntries(adapters.map((a) => [a.key, a.trust]));
  const raws = db
    .prepare(`SELECT payload FROM raw_events ORDER BY source_key, extracted_at`)
    .all() as unknown as Array<{ payload: string }>;
  // Process highest-trust sources first so provenance starts from the best data.
  raws.sort((a, b) => {
    const ta = trustRows[(JSON.parse(a.payload) as { sourceKey: string }).sourceKey] ?? 0;
    const tb = trustRows[(JSON.parse(b.payload) as { sourceKey: string }).sourceKey] ?? 0;
    return tb - ta;
  });
  const stats: CanonicalizeStats = { created: 0, merged: 0, unchanged: 0, skippedNoDates: 0 };
  for (const r of raws) {
    // touch=false: offline reprocessing must not fabricate freshness.
    await canonicalizeRawEvent(db, JSON.parse(r.payload), trustRows, stats, {
      touch: false,
      slugHints,
    });
  }
  const rebuildToday = new Date().toISOString().slice(0, 10);
  // Union same-market rows that ingestion order split (a bridge raw joined one
  // and orphaned the other), before confidence is scored on the merged sources.
  const consolidated = mergeDuplicateEvents(db);
  const pinned = await backfillGeocode(db);
  const inout = backfillIndoorOutdoor(db);
  const stalls = backfillStallCount(db);
  const freeEntry = backfillIsFree(db);
  expirePastEvents(db, rebuildToday);
  recomputeConfidence(db, trustRows, rebuildToday, confirmations);
  console.log(
    'rebuild done:',
    JSON.stringify({ ...stats, consolidated, pinned, inout, stalls, freeEntry }),
  );
  process.exit(0);
}

if (command === 'tips') {
  // Parse community tips into draft events at LOW trust ("ubekræftet").
  const { listTips, setTipStatus } = await import('@loppefund/db');
  upsertSource(db, { key: 'tip', name: 'Fællesskabstip', baseUrl: 'https://jacobtop-tcg.github.io/loppefund/tip', trust: 0.35 });
  const trustAll = { ...Object.fromEntries(adapters.map((a) => [a.key, a.trust])), tip: 0.35 };
  const today = new Date().toISOString().slice(0, 10);
  const tips = listTips(db, 'new');
  const stats: CanonicalizeStats = { created: 0, merged: 0, unchanged: 0, skippedNoDates: 0 };
  let unparsed = 0;
  for (const tip of tips) {
    const raw = parseTip(tip, today);
    if (!raw) {
      unparsed++;
      console.log(`[tip ${tip.id}] kunne ikke parses automatisk — kræver et menneske:`, (tip.text ?? tip.url ?? '').slice(0, 80));
      continue;
    }
    await canonicalizeRawEvent(db, raw, trustAll, stats);
    setTipStatus(db, tip.id, 'processed');
    console.log(`[tip ${tip.id}] -> "${raw.title}" (${raw.occurrences?.[0]?.date})`);
  }
  console.log(`tips: ${tips.length} nye, ${stats.created} oprettet, ${stats.merged} matchede eksisterende, ${unparsed} kræver manuel behandling`);
  process.exit(0);
}

if (command === 'venues') {
  // Refresh the permanent-venue layer from OpenStreetMap (standalone).
  upsertSource(db, {
    key: 'osm',
    name: 'OpenStreetMap',
    baseUrl: 'https://www.openstreetmap.org',
    trust: 0.6,
  });
  const runId = startRun(db, 'osm');
  const stats = await ingestOsmVenues(db);
  finishRun(db, runId, stats);
  console.log('venues done:', JSON.stringify(stats));
  process.exit(0);
}

if (command === 'discover-sources') {
  if (values.promote || values.reject) {
    const domain = (values.promote ?? values.reject)!;
    setCandidateStatus(db, domain, values.promote ? 'promoted' : 'rejected', values.note);
    console.log(`${domain} -> ${values.promote ? 'promoted' : 'rejected'}`);
    if (values.promote) {
      console.log('Next step: write a SourceAdapter in packages/pipeline/src/adapters/ and register it.');
    }
    process.exit(0);
  }

  const runId = startRun(db, 'discovery');
  const ownDomains = new Set(
    adapters.map((a) => new URL(a.baseUrl).hostname.replace(/^www\./, '')),
  );
  const raws = (
    db.prepare(`SELECT payload FROM raw_events`).all() as unknown as Array<{ payload: string }>
  ).map((r) => JSON.parse(r.payload) as RawEvent);
  // Titles we already have canonically — lets mining flag candidates whose
  // markets are already in the database (an operator link, not a new source).
  const canonicalTitles = new Set(
    (
      db
        .prepare(`SELECT title FROM events WHERE status = 'active'`)
        .all() as unknown as Array<{ title: string }>
    ).map((r) => normalizeTitle(r.title)),
  );
  const mined = mineDomains(raws, ownDomains, canonicalTitles);
  const now = new Date().toISOString();
  for (const m of mined) {
    upsertSourceCandidate(db, { ...m, seenAt: now });
  }
  console.log(`mined ${raws.length} raw events -> ${mined.length} candidate domains`);

  const probeLimit = Number(values['probe-limit'] ?? '10');
  const minMentions = Number(values['min-mentions'] ?? '2');
  const toProbe = listSourceCandidates(db, { status: 'candidate', minMentions }).slice(0, probeLimit);
  const probeFetcher = new PoliteFetcher();
  for (const c of toProbe) {
    console.log(`[probe] ${c.domain}…`);
    const { signals, score } = await probeDomain(c.domain, (u) => probeFetcher.fetch(u));
    markCandidateProbed(db, c.domain, { score, signals });
  }

  const rows = listSourceCandidates(db);
  finishRun(db, runId, {
    domains: mined.length,
    probed: toProbe.length,
    strong: rows.filter((r) => (r.probe_score ?? 0) >= 6).length,
  });
  console.log(values.json ? JSON.stringify(rows, null, 2) : formatReport(rows));

  // The actionable shortlist: candidates referencing at least one market whose
  // title we can't match to an existing event. Most high-mention domains are
  // operator links for markets we already have (verified: olg.dk 1/1 covered,
  // gentofteloppemarked.dk 2/2), so ranking by mentions alone sends an operator
  // re-checking known markets. This cuts the list to the ones worth a look —
  // an exact-title heuristic, so it over-includes rather than drops (see
  // netNewCandidates). Each line shows how many titles look new of the total.
  const netNew = netNewCandidates(mined).slice(0, 20);
  if (!values.json) {
    console.log(
      netNew.length === 0
        ? '\nNet-new candidates: none — every mined domain matches markets we already have.'
        : `\nNet-new candidates (reference a market whose title isn't in the database yet — look here first):\n` +
            netNew
              .map(
                (m) =>
                  `  ${m.domain}  ~${m.distinctTitles - (m.coveredTitles ?? 0)} maybe-new of ${m.distinctTitles} titles · ${m.mentions} mentions`,
              )
              .join('\n'),
    );
  }
  process.exit(0);
}

const limit = values.limit ? Number(values.limit) : Infinity;
const selected = values.source
  ? adapters.filter((a) => a.key === values.source)
  : adapters;
if (selected.length === 0) {
  console.error(`Unknown source "${values.source}". Available: ${adapters.map((a) => a.key).join(', ')}`);
  process.exit(1);
}

const fetcher = new PoliteFetcher();
const trustMap = Object.fromEntries(adapters.map((a) => [a.key, a.trust]));

// Captured before any crawling: raw_events whose extracted_at predates this
// stamp were NOT re-seen this run. Used after the loop to expire events a
// healthily-crawled source has stopped listing.
const runStart = new Date().toISOString();
const fullCrawl = limit === Infinity;
const healthySources: string[] = [];

for (const adapter of selected) {
  upsertSource(db, {
    key: adapter.key,
    name: adapter.name,
    baseUrl: adapter.baseUrl,
    trust: adapter.trust,
  });
  const runId = startRun(db, adapter.key);
  const stats: CanonicalizeStats & {
    discovered: number; fetched: number; fetchErrors: number;
    extracted: number; expired: number;
  } = {
    discovered: 0, fetched: 0, fetchErrors: 0, extracted: 0,
    created: 0, merged: 0, unchanged: 0, skippedNoDates: 0, expired: 0,
  };
  // API-shaped sources return raw events in bulk.
  if (adapter.fetchRawEvents) {
    console.log(`[${adapter.key}] fetching via API…`);
    const raws = (await adapter.fetchRawEvents((u) => fetcher.fetch(u))).slice(0, limit);
    stats.discovered = raws.length;
    let n = 0;
    for (const raw of raws) {
      n++;
      stats.extracted++;
      await canonicalizeRawEvent(db, raw, trustMap, stats);
      if (n % 100 === 0) {
        console.log(`[${adapter.key}] ${n}/${raws.length} — created ${stats.created}, merged ${stats.merged}`);
      }
    }
    const expiredApi = expirePastEvents(db, new Date().toISOString().slice(0, 10));
    stats.expired = expiredApi;
    // A clean full API pull is trustworthy enough to reconcile disappearances.
    if (fullCrawl && stats.discovered > 0) healthySources.push(adapter.key);
    finishRun(db, runId, stats);
    console.log(`[${adapter.key}] done:`, JSON.stringify(stats));
    continue;
  }

  console.log(`[${adapter.key}] discovering…`);
  const urls = (await adapter.discover((u) => fetcher.fetch(u))).slice(0, limit);
  stats.discovered = urls.length;
  console.log(`[${adapter.key}] ${urls.length} event pages to process`);

  let i = 0;
  for (const url of urls) {
    i++;
    const res = await fetcher.fetch(url);
    recordDocument(db, {
      sourceKey: adapter.key,
      url,
      httpStatus: res.status,
      contentHash: res.body ? hashContent(res.body) : null,
    });
    if (res.status !== 200) {
      stats.fetchErrors++;
      continue;
    }
    stats.fetched++;
    const raw = adapter.extract(url, res.body);
    if (!raw) continue;
    stats.extracted++;
    await canonicalizeRawEvent(db, raw, trustMap, stats);
    if (i % 25 === 0) {
      console.log(`[${adapter.key}] ${i}/${urls.length} — created ${stats.created}, merged ${stats.merged}, unchanged ${stats.unchanged}`);
    }
  }
  const expired = expirePastEvents(db, new Date().toISOString().slice(0, 10));
  stats.expired = expired;
  // Only a complete crawl with zero fetch errors is safe to reconcile against —
  // a partial or flaky crawl would look like events "vanished" when they didn't.
  if (fullCrawl && stats.discovered > 0 && stats.fetchErrors === 0) {
    healthySources.push(adapter.key);
  }
  finishRun(db, runId, stats);
  console.log(`[${adapter.key}] done:`, JSON.stringify(stats));
}

// Cancellation detection: for each source that was just fully and cleanly
// crawled, expire the events it has stopped listing (present last run, absent
// now = cancelled/removed). Reversible — a re-listed event is restored to
// 'active' on its next crawl — and gated on a healthy full crawl so a source
// outage never mass-expires. Events that merely lost ONE of several sources are
// re-derived so the vanished source's dates drop out. "Incorrect over missing."
if (healthySources.length > 0) {
  const reconcileStats: CanonicalizeStats = {
    created: 0, merged: 0, unchanged: 0, skippedNoDates: 0,
  };
  let pruned = 0;
  let expired = 0;
  const survivors = new Set<number>();
  for (const key of healthySources) {
    const r = reconcileVanishedSourceEvents(db, key, runStart);
    pruned += r.prunedRawEvents;
    expired += r.expiredEvents;
    r.survivingEventIds.forEach((id) => survivors.add(id));
  }
  for (const eventId of survivors) {
    const payload = anyLinkedPayload(db, eventId);
    if (payload) {
      await canonicalizeRawEvent(db, JSON.parse(payload) as RawEvent, trustMap, reconcileStats, {
        touch: false,
      });
    }
  }
  console.log(
    `reconcile vanished: pruned ${pruned} raw events, expired ${expired} events, re-derived ${survivors.size}`,
  );
}

// Fold same-market rows that ingestion order split into duplicates, before
// confidence is scored on the (now merged) source set.
const consolidated = mergeDuplicateEvents(db);
if (consolidated > 0) console.log(`consolidated ${consolidated} duplicate event(s)`);

// Put pinless-but-addressable markets back on the map (heals events geocoded
// while the cache was poisoned; a fresh lookup resolves them now).
const pinned = await backfillGeocode(db);
if (pinned > 0) console.log(`backfilled coordinates for ${pinned} event(s)`);

// Infer indoor/outdoor for events their sources left blank (powers the filter
// and the rain warning). High-precision heuristic; only fills 'unknown'.
const inout = backfillIndoorOutdoor(db);
if (inout > 0) console.log(`inferred indoor/outdoor for ${inout} event(s)`);

// Recover a stall count stated in the description for sources with no stalls
// field ("…med op til 150 stader"). Precision-only; a strong "worth driving to"
// and hidden-gem signal.
const stalls = backfillStallCount(db);
if (stalls > 0) console.log(`extracted stall counts for ${stalls} event(s)`);

// Infer free/paid entry stated in the description ("gratis entré"). Precision-
// only and non-contradictory; a wrong "Gratis" badge is never worth the risk.
const freeEntry = backfillIsFree(db);
if (freeEntry > 0) console.log(`inferred entry fee for ${freeEntry} event(s)`);

// Freshness decay only works if scores are actually recomputed after crawls.
recomputeConfidence(db, trustMap, new Date().toISOString().slice(0, 10), confirmations);

// Refresh the permanent-venue layer (thrift/antique/flea shops) from
// OpenStreetMap on a full crawl. Isolated in try/catch: Overpass is a
// third-party API and an outage there must never fail the whole deploy — the
// previously-ingested venues simply stay as they were.
if (fullCrawl) {
  try {
    upsertSource(db, {
      key: 'osm',
      name: 'OpenStreetMap',
      baseUrl: 'https://www.openstreetmap.org',
      trust: 0.6,
    });
    const venueStats = await ingestOsmVenues(db);
    console.log('osm venues:', JSON.stringify(venueStats));
  } catch (e) {
    console.error('osm venue ingest failed (kept existing venues):', (e as Error).message);
  }

  // Authoritative charity-chain shops (with the opening hours OSM lacks). Runs
  // AFTER the OSM ingest so a chain shop can enrich the OSM venue it matches.
  // Each chain is isolated: one site's outage never fails the deploy or the
  // others. The operator's own store list is highly authoritative (trust 0.8).
  const geocodeAddress = async (a: { street?: string | null; postcode?: string | null; city?: string | null }) => {
    const g = await geocode(db, {
      street: a.street ?? undefined,
      postcode: a.postcode ?? undefined,
      city: a.city ?? undefined,
    });
    return g.lat != null && g.lng != null ? { lat: g.lat, lng: g.lng } : null;
  };
  const chains = [
    { key: 'kirkenskorshaer', name: 'Kirkens Korshær', baseUrl: 'https://kirkenskorshaer.dk', fetch: fetchKirkensKorshaerVenues },
    { key: 'folkekirkensnoedhjaelp', name: 'Folkekirkens Nødhjælp', baseUrl: 'https://www.noedhjaelp.dk', fetch: fetchFolkekirkensNoedhjaelpVenues },
    { key: 'rodekors', name: 'Røde Kors', baseUrl: 'https://www.rodekors.dk', fetch: fetchRodekorsVenues },
  ];
  for (const chain of chains) {
    try {
      upsertSource(db, { key: chain.key, name: chain.name, baseUrl: chain.baseUrl, trust: 0.8 });
      const shops = await chain.fetch();
      const chainStats = await ingestChainVenues(db, shops, { geocodeAddress });
      console.log(`${chain.name} venues:`, JSON.stringify(chainStats));
    } catch (e) {
      console.error(`${chain.name} venue ingest failed (kept existing venues):`, (e as Error).message);
    }
  }
}
