# Loppefund — design

**Date:** 2026-07-02
**Status:** approved for implementation (autonomous session; founder decisions made inline)

## Mission

The definitive, continuously updated database of every flea market in Denmark —
loppemarkeder, kræmmermarkeder, bagagerumsmarkeder, antikmarkeder, genbrugssalg,
church and charity sales — wrapped in a consumer experience so fast and trustworthy
that it replaces Facebook, Google and Markedskalenderen for weekend planning.

**Trust is the product.** Missing events are acceptable; wrong events are not.
Every event carries a confidence score, every field carries provenance, every
update is traceable.

## Verified ground truth (recon 2026-07-02)

- **DAWA** (`api.dataforsyningen.dk`) is reachable and free — solves Danish
  address → coordinate geocoding with match quality.
- **markedskalenderen.dk**: robots.txt allows everything. Event pages at
  `/marked/show/<slug>` have cleanly labeled fields: Markedstype, Adresse,
  Stedbeskrivelse, Inden-/udendørs, Kommune, Arrangør, Perioder (explicit
  `dd-mm-yyyy til dd-mm-yyyy` ranges), recurrence text ("Søndag i alle ulige
  uger"), Åbningstid ("Søndag 12-17"), Entrébetaling, Antal stadepladser,
  contact info, stall prices. Category index pages at `/marked/kategori/<cat>`.
- **kultunaut.dk**: reachable; robots.txt allows `/perl/arrlist/` and
  `/perl/arrmore/`. Denmark's largest event calendar; powers many municipal
  and library calendars (white-label), so one adapter covers many "sources".
  Exact listing URL under research (background agent).
- **Facebook/Instagram**: auth-walled; out of scope for automated crawling in v1.
  Architecture leaves room for user-submitted FB links + manual import later.
- **node:sqlite** (built-in, SQLite 3.53) with FTS5 works on this machine —
  zero native dependencies for the data layer.

## Architecture

npm-workspaces monorepo, TypeScript everywhere, vitest for tests.

```
packages/core       pure domain logic — types, Danish date/schedule parser,
                    normalization, dedup matching, confidence scoring.
                    No I/O. Heavily unit-tested.
packages/db         node:sqlite schema, migrations, repositories, FTS5 search.
packages/pipeline   polite fetcher (rate-limited, robots-aware, content-hashing),
                    SourceAdapter framework, per-source adapters (each an
                    independent module), DAWA geocoder (cached), canonicalizer,
                    CLI runner, run observability.
apps/web            Next.js consumer app (Danish UI): weekend view, instant
                    search + filters, MapLibre map with clustering, event
                    detail with provenance.
```

One SQLite file (`data/loppefund.db`) is the single source of truth. The web
app reads it directly via server components — no API layer needed yet; the
repository layer in `packages/db` is the seam where Postgres/API can slot in
when scaling to Europe.

### Data model

- `sources` — registered origins (adapter key, base url, trust 0–1, active).
- `documents` — every fetched page: url, source, fetched_at, content_hash,
  http_status. Change detection = hash diff.
- `raw_events` — extraction output per document, JSON payload + extraction
  notes. Immutable audit trail.
- `events` — canonical markets: slug, title, description, category, venue,
  address (street/postcode/city/municipality), lat/lng + geocode quality,
  organizer, contact (web/email/phone), price_text + is_free, stall count,
  indoor/outdoor, schedule_text, status (active/cancelled/expired),
  confidence 0–1, first_seen, last_seen, last_verified.
- `occurrences` — concrete dated instances (event_id, starts_at, ends_at,
  status). Materialized from explicit dates and resolved recurrence rules,
  horizon ~180 days.
- `event_sources` — event ↔ raw_event links: which source contributed,
  first/last seen. Field-level provenance JSON on the event row.
- `pipeline_runs` — per run: source, started/finished, counts (fetched,
  extracted, new, updated, unchanged, errors). Observability without infra.

### Canonicalization & trust

Dedup match: candidate pairs by (a) geo proximity < 500 m or same postcode,
(b) normalized-title similarity (Dice bigram ≥ 0.55), (c) occurrence-date
overlap as tiebreaker. Deterministic, unit-tested; conservative — when in
doubt, keep separate (a duplicate is annoying, a wrong merge destroys trust).

Merge policy: field-wise, highest source-trust wins; longer description wins
ties; every field records winning source. Conflicting *dates* from equal-trust
sources lower confidence rather than guessing.

Confidence score = f(source trust, corroborating source count, days since
last verification, completeness of critical fields, geocode quality). Events
below threshold render with an explicit "ubekræftet" marker; events past
their last occurrence expire automatically.

### Danish schedule parser (core differentiator)

Resolves vague Danish into concrete dates: explicit dates and ranges
(`05-07-2026 til 06-07-2026`, `lørdag den 5. juli kl. 10-16`), opening hours
(`Søndag 12-17`, `kl. 10.00-16.00`), and recurrence (`hver søndag`,
`første lørdag i måneden`, `søndag i alle ulige uger` — ISO week parity).
Output: concrete occurrences within horizon. TDD; this is where correctness
lives or dies.

### Politeness & legitimacy

Respect robots.txt (checked per host, cached). ≥ 1.5 s between requests per
host. Descriptive User-Agent (`LoppefundBot/0.1 (+contact)`). Content-hash
caching to avoid refetching unchanged pages. Every event links back to its
sources — we aggregate and attribute, never plagiarize descriptions without
provenance.

## Consumer UX (v1)

Danish-language, mobile-first, premium-minimal.

1. **Forside = "I weekenden"** — the Friday-evening question answered
   instantly: markets this weekend, sorted by relevance/distance, with
   date chips (I dag / I morgen / Weekend / Næste weekend / Vælg dato).
2. **Instant filters** — kategori, indendørs/udendørs, gratis entré,
   distance from user location (geolocation, fallback: choose city).
3. **Search** — FTS5-backed, as-you-type, over title/venue/city/description.
4. **Map** — MapLibre GL, clustered markers, popup cards, synced to filters.
5. **Event page** — everything a family needs: next dates, hours, address +
   map, entry fee, stalls, indoor/outdoor, parking notes, organizer contact,
   and the trust block: sources, last verified, confidence.

Deferred (backlog, deliberately): accounts, personalization, community
contributions, route planning, native apps, additional countries. The data
foundation is built so none of these require re-architecture.

## Alternatives considered

- **Next.js vs Vite SPA + API**: Next.js chosen — SEO is a real acquisition
  channel for a consumer discovery product; server components read SQLite
  directly, removing an entire API tier.
- **better-sqlite3 vs node:sqlite**: built-in `node:sqlite` chosen — FTS5
  verified working, zero native-build risk on Node 25.
- **LLM extraction vs deterministic parsers**: deterministic parsers for the
  structured sources (they're cleanly labeled); keeps the pipeline free,
  fast, reproducible and testable. LLM extraction is the right tool for
  messy free-text sources later — the RawEvent seam supports both.

## Testing

- `core`: exhaustive unit tests (schedule parser, dedup, normalization,
  confidence) — vitest.
- `pipeline`: adapter tests against saved HTML fixtures from the real sites
  (no network in tests).
- `db`: repository round-trip tests on in-memory SQLite.
- End-to-end: pipeline run against live sources, web app verified in browser.
