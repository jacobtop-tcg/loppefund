/**
 * Pipeline CLI:
 *   node packages/pipeline/src/cli.ts run [--source key] [--limit N] [--db path]
 *   node packages/pipeline/src/cli.ts rebuild [--db path]
 *   node packages/pipeline/src/cli.ts stats [--db path]
 *   node packages/pipeline/src/cli.ts discover-sources [--probe-limit N] [--min-mentions N]
 *       [--json] [--promote domain | --reject domain [--note text]]
 */
import { parseArgs } from 'node:util';
import type { RawEvent } from '@loppefund/core';
import {
  expirePastEvents,
  finishRun,
  listSourceCandidates,
  markCandidateProbed,
  openDb,
  recordDocument,
  setCandidateStatus,
  startRun,
  upsertSource,
  upsertSourceCandidate,
  hashContent,
} from '@loppefund/db';
import { PoliteFetcher } from './fetcher.ts';
import {
  canonicalizeRawEvent,
  recomputeConfidence,
  type CanonicalizeStats,
} from './canonicalize.ts';
import { formatReport, mineDomains, probeDomain } from './discovery.ts';
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
    await canonicalizeRawEvent(db, JSON.parse(r.payload), trustRows, stats);
  }
  const rebuildToday = new Date().toISOString().slice(0, 10);
  expirePastEvents(db, rebuildToday);
  recomputeConfidence(db, trustRows, rebuildToday);
  console.log('rebuild done:', JSON.stringify(stats));
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
  const mined = mineDomains(raws, ownDomains);
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
  finishRun(db, runId, stats);
  console.log(`[${adapter.key}] done:`, JSON.stringify(stats));
}

// Freshness decay only works if scores are actually recomputed after crawls.
recomputeConfidence(db, trustMap, new Date().toISOString().slice(0, 10));
