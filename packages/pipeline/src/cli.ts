/**
 * Pipeline CLI:
 *   node packages/pipeline/src/cli.ts run [--source key] [--limit N] [--db path]
 *   node packages/pipeline/src/cli.ts stats [--db path]
 */
import { parseArgs } from 'node:util';
import {
  expirePastEvents,
  finishRun,
  openDb,
  recordDocument,
  startRun,
  upsertSource,
  hashContent,
} from '@loppefund/db';
import { PoliteFetcher } from './fetcher.ts';
import { canonicalizeRawEvent, type CanonicalizeStats } from './canonicalize.ts';
import { adapters } from './adapters/index.ts';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    source: { type: 'string' },
    limit: { type: 'string' },
    db: { type: 'string', default: 'data/loppefund.db' },
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
  const stats: CanonicalizeStats & Record<string, number> = {
    discovered: 0, fetched: 0, fetchErrors: 0, extracted: 0,
    created: 0, merged: 0, unchanged: 0, skippedNoDates: 0,
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
