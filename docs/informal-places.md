# Skjulte loppesteder (`informal_place`)

The third entity class in Loppefund, alongside **events** (dated markets) and
**venues** (permanent shops). It models the places that hide the real finds:
private loppelader, gårdsalg, recurring garagesalg, dødsbo lagers, self-service
loppeskure, "åbent når flaget er ude".

This document is the whole contract. If you read nothing else, read
[Privacy](#privacy-the-one-rule-that-cannot-bend) and [The two scores](#the-two-scores).

---

## Why a third entity

Both walls are load-bearing. Do not knock either down.

**Not an event.** Events are dated; an informal place has a *habit* — "some
Sundays", "when the flag is out". Forcing it into `occurrences` is a failure this
repo already survived: `resolveSchedule`'s `MAX_CONSECUTIVE_FILL` (packages/core
schedule.ts) exists because a 24/7 private sale once exploded into 30 daily
markets.

**Not a venue.** Venues (packages/core venue.ts) are OSM/chain businesses, keyed
on a stable external id, corroborated *by construction* — which is why they carry
no confidence and no provenance. A private barn known from one Facebook post
needs both.

**Do not widen `EventCategory`.** It is the stored `events.category`, the return
type of `normalizeCategory`, and an input to the dedupe vetoes. `InformalPlaceType`
is its own vocabulary.

---

## Privacy: the one rule that cannot bend

> **On a static export, published = public, permanently, to everyone.**

Anything serialized into the build is world-readable at a guessable URL, crawled,
and mirrored by the Wayback Machine. A React conditional that "hides" an address
is theatre — the value is already in the payload the browser downloaded.

**Therefore address visibility is enforced in the data layer, never in the UI.**

```
stored row (may hold a precise address)
        │
        ▼
publicView()            ← packages/core/src/informal-visibility.ts
        │                  the ONLY sanctioned path to publication
        ▼
PublicInformalPlace     ← structurally cannot carry a precise address for a
        │                  blurred place; a UI bug cannot leak what isn't there
        ▼
lib/informal.ts         ← the web app's only door; also drops anything that
        │                  still fails findVisibilityLeaks()
        ▼
pages / informal-places.json
```

### `AddressVisibility`

| Value | Published |
|---|---|
| `fuld` | Full street + exact coordinate. **Requires** an affirmative signal (see the data-quality check). |
| `omraade` | No street. Coordinate blurred to a ~2 km grid cell. **The default.** |
| `kun-aabningsdage` | Degrades to `omraade` + "contact first" — see below. |
| `kontakt-kraeves` | No street, **no map pin at all**. |
| `intern` | Never published in any form (`publicView` returns `null`). |
| `ikke-offentlig` | Never published. |

**Why `kun-aabningsdage` degrades:** on a static host we cannot reveal an address
"only on opening days", because shipping it at all ships it forever. The field
still exists because the rule is modelled — the day this app gains a server, only
that branch of `publicView()` changes.

**Blurring** (`blurCoord`) snaps to a grid cell centre, deterministically. Not a
random jitter: a random offset that changes per build would let anyone
triangulate the true point by sampling. Grid size `AREA_GRID_DEG = 0.02` (≈2.2 km).

**Never published, ever:** source `excerpt`, `verifiedBy` (moderator identity),
`moderationNotes`. The public view ships source *type + url + date* only — enough
to audit provenance without republishing someone's post or naming a moderator.

**`findVisibilityLeaks(stored, view)`** is the regression guard. Call it in tests
and in the data-quality report. It exists because the leak we fear is silent: a
refactor starts copying `street` through, and nobody notices until a private
address is in the Wayback Machine.

---

## The two scores

They answer **different questions** and must never be blended.

|  | `confidence` | `fundScore` |
|---|---|---|
| Question | "Is this real, and still a thing?" | "Is it worth the drive?" |
| Module | `informal-confidence.ts` | `fund-score.ts` |
| Weights | `INFORMAL_W` | `FUND_W` |
| Range | 0..100 | 0..100 (normalised by `FUND_SCALE`) |

**They pull in opposite directions — that is the product's whole insight.** The
barn most likely to hide a bargain is exactly the one with the thinnest paper
trail. A test pins this: one old anonymous post about an unsorted barn scores
**<45 confidence (Radar)** and **>60 fund**.

### Why the existing models could not be reused

- `computeConfidence` (events) caps a lone low-trust source at **0.44**, lifting
  it only with aggregator corroboration. Sound for markets in several public
  calendars; fatal for a barn known from one true Facebook post.
- `isHiddenGem` gates at `confidence >= 0.7` — **unreachable** for a tip-sourced
  place — *and* requires `sourceCount === 1` exactly, so corroborating a place
  would **remove** its badge.

### Tuning

Every weight is a named constant in one place. **Change scoring only by editing
`INFORMAL_W` / `FUND_W`** — never by scattering adjustments through callers.
Both functions are pure and take `today` as a parameter, so they are
deterministic, reproducible in a build, and testable.

Both return `{ score, reasons[], summary }`. **The reasons are not optional** —
a score without its reasoning is a number the user must take on faith, and this
product is built on not asking for that.

`fundScore` wording stays hedged ("ser lovende ud"). It is an estimate of
potential, never a promise.

### `FUND_SCALE` (why normalisation exists)

The first real ingest produced **100/100 for both** a verified barn and a one-tip
dødsbo lager: the positives sum to 157 raw points, so anything with half the
signals pinned the ceiling, and a score that says 100 about everything cannot
rank. Normalising by the measured theoretical maximum keeps each weight meaning
what it says while making the *output* discriminate (the two places now separate
at 83 vs 80).

**Known:** `confidence` can still reach 100 at the top end. Left deliberately —
"certain" is a meaningful reading there, and the model demonstrably discriminates
across the rest of the range.

---

## The three trust layers

`trustLayerFor()` (informal-place.ts). Deliberately conservative: anything
uncertain falls to Radar.

| Layer | Meaning |
|---|---|
| `bekraeftet` | `confirmed_active` **and** `confidence >= INFORMAL_CONFIRMED_MIN` (70). Plan a Saturday around it. |
| `kontroller-foerst` | Real, but the opening is unpredictable. Ring first. |
| `radar` | A lead. `confidence < INFORMAL_RADAR_MAX` (45), or unverified/possibly-inactive/historical. |

**The separation is a visual grammar, not a label.** `/skjulte-steder` renders
three separate sections, dependable first, Radar dimmed + dashed + rule-separated,
its copy leading with what we *don't* know. Sorting by fund score happens **within**
a layer, never across — so a tempting lead cannot outrank a confirmed place.
The seeded pair proves it: the Radar dødsbo lager scores 83 fund vs the confirmed
barn's 80, and still sits below it.

---

## Lifecycle

`InformalPlaceStatus`: `confirmed_active`, `recently_observed`, `active_online`,
`sporadic`, `call_first`, `unverified`, `possibly_inactive`, `historical`,
`rejected`.

Decay thresholds live in `informal-quality.ts` and are configurable:

| Constant | Default | Meaning |
|---|---|---|
| `FRESH_DAYS` | 60 | Full recency credit in confidence |
| `STALE_DAYS` | 540 | Recency credit reaches zero |
| `SINGLE_OBS_STALE_DAYS` | 180 | A lone observation older than this is a rumour |
| `STALE_AFTER_DAYS` | 365 | `confirmed_active` beyond this is flagged |
| `HISTORICAL_AFTER_DAYS` | 540 | Anything still claiming to be live is flagged |
| `CLOSED_REPORT_QUORUM` | 2 | Reports needed before the closed-penalty bites fully |

---

## Entity resolution

`matchInformalPlaces()` (informal-resolve.ts). **The error to avoid is merging two
different private sellers**: one village road can hold three unrelated barns, and
a wrong merge puts a stranger's goods behind another person's phone number.

- **Only a hard identity may auto-merge** — a normalised phone or a Facebook
  profile. Stacked weak signals reach `review` at most, never `merge`.
- **Conflicting phones veto outright.**
- **Different house numbers in the same town push records apart** (`differentStreetSameCity`).
- `findMergeSuggestions()` only ever **reports**; even a `merge` verdict is applied
  by a human, because folding two records is destructive.

`normalizePhone` refuses partials and placeholders (`12345678`, `22222222`) — a
partial number must never become a merge key.

`detectRecurrence()` needs **≥3 observations spanning ≥21 days** before proposing
"this looks like a recurring hidden place", so a burst of posts about one weekend
can never become a permanent pin.

---

## Classification

`classifyPost()` (informal-classify.ts). Rule-based and deterministic **on
purpose**: the vocabulary is small, stable and idiomatic, rules read it
accurately, run free in the build, and can be argued with line by line. The
interface is model-shaped (text in, label + confidence + evidence out) so an
ML/LLM classifier can be slotted behind it later without touching a caller.

**The fork that matters:** `enkeltstaaende_privatsalg` vs `informal_place`. A
one-off must never become a permanent map pin at a private home, so **ties go to
the cautious side**: a one-off wins, recurrence must be positively evidenced, and
a habit phrase *without* recurrence is flagged `needsReview` rather than published.

Measured on 404 real Facebook posts: 245 `loppemarked` (public markets — the event
pipeline's job), 87 `irrelevant`, 69 `kraever_review`, **2 `informal_place`**.

> **The corpus is the bottleneck, not the classifier.** The harvester has 8 groups
> and 29 event-searches configured; a run produced 332 event listings and **2 group
> posts**, because the time budget burns on searches that return markets we already
> have. Hidden places live in *group posts*. Fixing that priority is the highest-value
> change available to this feature.

---

## Ingest & review flow

**There is no backend.** The site is a static export, so nothing user-submitted
can reach the database on its own. Every community input here works the same way,
and for informal places that human gate is the *product promise*, not a
limitation to route around: these records point at private homes, so **a scraped
post is a lead, never a publication**.

```
/tip-perle  ──POST──▶  Web3Forms  ──▶  operator inbox
                                          │  a human vets
                                          ▼
                            data/informal-places.json   (committed)
                                          │
                                          ▼
                        cli.ts informal-places  (in the crawl)
                                          │  scores computed HERE and stored
                                          ▼
                                    informal_places
```

Run it:

```bash
node packages/pipeline/src/cli.ts informal-places --db data/loppefund.db
```

It prints ingest stats, **merge suggestions** (never applied), and the
**data-quality report**.

`data/informal-places.json` is an array of `VettedInformalPlace`
(packages/pipeline/src/informal-ingest.ts). Notes:

- `addressVisibility` **defaults to `omraade`** — an entry must *opt in* to a full
  address, never inherit one by omission.
- A place with no city, postcode **and** no coordinate is **skipped**, not pinned
  at a guess.
- Re-running is idempotent; visit reports are replaced wholesale so the vetted
  file stays the source of truth.

---

## Data-quality report

`checkInformalQuality()` (informal-quality.ts). Runs in the crawl. **Nothing
mutates** — a report that quietly "fixed" things would hide the decay it exists
to surface.

Severities are ranked by what they'd cost a real person:

- **error** — actively harmful: a full address nobody vetted, a coordinate in the
  sea, a score outside 0..100, an unknown `address_visibility` (must never be
  treated as permissive by a later default), a `kontakt-kraeves` place with no
  contact route.
- **warn** — likely wrong: stale "confirmed", no sources, invalid phone, duplicate
  phone/address, a recurrence claim with no history.
- **info** — counts.

---

## Web surfaces

| Route | What |
|---|---|
| `/skjulte-steder` | Overview, three trust sections |
| `/perle/[slug]` | Detail: both scores with reasoning, provenance, warnings |
| `/tip-perle` | The intake form |
| `/informal-places.json` | Lazy static asset (mirrors `venues.json`) |

`/perle/` is a **new namespace on purpose**: `/marked/` and `/sted/` are
published, sitemapped and IndexNow-pushed, and each makes a promise about what
you'll find.

**`generateStaticParams` must never return empty** — `output: export` errors on an
empty dynamic route and that kills the deploy. Empty is the *normal* case here (a
cached pre-v4 DB, or no vetted places yet), so `informalPlaceSlugs()` returns a
`__none__` sentinel, exactly as `/sted/[slug]` already does.

---

## The deploy trap (read before adding any table)

`migrate()` runs **only** from `openDb()`. The static export uses
`openDbReadOnly()`, which never migrates, and **a push to main builds from a
cached DB** that may predate your tables.

**Therefore every read path must be guarded**:

```ts
if (!informalPlacesTableExists(db)) return [];   // degrade, never throw
```

This is the `venuesTableExists()` lesson, applied before it could bite. Without
it, adding this feature would take the whole site down on the next code push.
Schema changes are **additive only**; slugs are never rewritten on conflict, so a
published URL cannot move.

---

## Testing

```bash
npx vitest run                      # everything
npx vitest run packages/core/src/informal-place.test.ts
```

Covered: the publication gate (including a hand-built leaking view), both score
models and their independence, trust layers, entity resolution (including the
"three barns on one road" refusal), recurrence detection, classification, schema
round-trip, the **pre-v4 database path**, and the data-quality checks.

---

## Known limitations

1. **The corpus, not the model.** See Classification. The harvester points at
   event searches; hidden places are in group posts.
2. **Photos** are directed to email — a static host has no upload. Modelled
   (`imageUrls`), not faked.
3. **Image analysis** is not implemented. `inventorySignals` is populated by
   humans via the tip form.
4. **Visit reports** are modelled and stored, and feed both scores, but they
   arrive through the same human-vetted rail; there is no live write path.
5. **Notifications / personalisation** are modelled (`inventorySignals`,
   categories) but not built.
6. **`confidence` saturates at the top** (see FUND_SCALE note).
7. **No admin UI.** Review is a committed JSON + the CLI report. That is the
   least-maintenance option that fits a static site; a heavier tool would be a
   liability.
