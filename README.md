# Loppefund

**Alle loppemarkeder i Danmark. Ét sted, altid opdateret.**

Loppefund is a consumer platform for discovering flea markets in Denmark —
loppemarkeder, kræmmermarkeder, bagagerumsmarkeder, antikmarkeder and charity
sales. It is built as a living database that continuously discovers, verifies,
deduplicates and updates events from public sources, wrapped in a fast,
premium web experience.

**Trust is the product.** Every event has a confidence score, every field has
provenance, and every event page links to its sources. Missing events are
acceptable; wrong events are not.

## Quick start

```bash
npm install

# Crawl all sources into data/loppefund.db (respectful crawling: ~1.5s/request)
node packages/pipeline/src/cli.ts run

# Or a single source / limited run
node packages/pipeline/src/cli.ts run --source markedskalenderen --limit 20

# Inspect the database
node packages/pipeline/src/cli.ts stats

# Re-derive all canonical events from the raw layer (offline, fast)
node packages/pipeline/src/cli.ts rebuild

# Self-discover new sources: mine the raw layer for recurring domains and
# probe them for event signals (JSON-LD, iCal, RSS, WP events API)
node packages/pipeline/src/cli.ts discover-sources --probe-limit 10
node packages/pipeline/src/cli.ts discover-sources --promote example.dk

# Start the app on http://localhost:3000
npm run web

# Run the test suite
npm test
```

Requires Node.js ≥ 22.5 (uses the built-in `node:sqlite`).

## Architecture

```
packages/core       Pure domain logic: Danish schedule parser ("første lørdag
                    i måneden" -> concrete dates), dedup matching, confidence
                    scoring, normalization. No I/O; heavily unit-tested.
packages/db         SQLite schema + repositories. Canonical events,
                    occurrences, raw events (immutable audit trail),
                    field-level provenance, FTS5 search with Danish folding,
                    geocode cache, pipeline run stats.
packages/pipeline   Polite fetcher (robots.txt, rate limiting, charset
                    sniffing), independent source adapters, DAWA geocoding,
                    canonicalizer (dedup + merge + confidence).
apps/web            Next.js consumer app (Danish UI): weekend explorer with
                    instant filters, clustered MapLibre map, event pages with
                    a visible trust block.
```

The raw layer is the source of truth: `raw_events` stores every extraction
verbatim, and the canonical layer can be rebuilt from it at any time
(`cli.ts rebuild`). Wrong merges are therefore always recoverable.

### Sources

| Adapter | What | Trust |
|---|---|---|
| `markedskalenderen` | markedskalenderen.dk — richest metadata (stalls, organizer, indoor/outdoor) | 0.7 |
| `kultunaut` | kultunaut.dk — Denmark's largest event calendar; also covers municipal white-label calendars | 0.65 |
| `loppemarkeder-nu` | loppemarkeder.nu — The Events Calendar JSON API | 0.6 |
| `findmarked` | findmarked.dk — schema.org Events with coordinates via sitemap | 0.55 |

All crawling respects robots.txt, uses a descriptive User-Agent
(`LoppefundBot`), and waits ≥1.5s between requests per host.

**Self-discovery**: `discover-sources` mines every stored raw event for
external domains (organizer sites, market calendars), aggregates how often
and across how many distinct markets each domain appears, then politely
probes candidates for machine-readable event signals. Domains scoring above
the promote threshold are adapter-ready — the funnel is
`candidate → probed → promoted → hand-written adapter`.

### Trust model

- **Dedup is conservative**: merging requires strong title similarity plus
  location agreement, or decent similarity plus co-location *and* date
  overlap. Different categories or different street addresses veto a merge.
- **Confidence** = source trust + corroboration + freshness + location
  quality + concrete dates. Events below 0.45 render as "ubekræftet".
- **No guessing**: events without resolvable dates are not shown; unknown
  times stay unknown rather than being invented; geocodes below DAWA
  quality B fall back to explicit postcode-centroid approximation.

## Production

```bash
# Verified production build (First Load JS ~113 kB)
npm run build --workspace @loppefund/web
npm run start --workspace @loppefund/web   # serves on :3000
```

Deployment needs a Node host with a persistent disk for `data/loppefund.db`
(a small VPS or Fly.io/Railway volume — Vercel's ephemeral filesystem won't
fit the SQLite architecture without moving the db to LiteFS/Turso). Set
`LOPPEFUND_BASE_URL` for correct sitemap/robots URLs and schedule the
pipeline (below). Facebook-group ingestion activates by setting
`LOPPEFUND_FB_FEED_URLS` to a scraping-vendor dataset URL (e.g. an Apify
actor scheduled vendor-side).

## Keeping data fresh

The pipeline is idempotent — re-running it detects changes (content hashes),
confirms events (freshness feeds the confidence score), picks up new dates
and expires markets whose last date has passed. Schedule it, e.g.:

```cron
# crontab -e — refresh every morning at 06:00
0 6 * * * cd "$HOME/Documents/Loppemarkeder i DK" && /usr/local/bin/node packages/pipeline/src/cli.ts run >> data/pipeline.log 2>&1
```

## Development

- `npm test` — vitest across all packages (adapter tests run against saved
  HTML fixtures from the real sites; no network in tests).
- Design spec: `docs/superpowers/specs/2026-07-02-loppefund-design.md`.
- Add a source: implement `SourceAdapter` in `packages/pipeline/src/adapters/`
  (either `discover()`/`extract()` for page-shaped sources or
  `fetchRawEvents()` for API-shaped ones) and register it in `adapters/index.ts`.
