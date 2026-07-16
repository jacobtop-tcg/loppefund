import type { DatabaseSync } from 'node:sqlite';

/** v4 adds the informal_places family. NOTE: nothing READS this — it is a
 *  record, not a gate. Every new table must therefore be guarded at its read
 *  paths (see informalPlacesTableExists in index.ts), because migrate() runs
 *  only from openDb(), and a code-push deploy builds from a cached DB that was
 *  never migrated. */
export const SCHEMA_VERSION = 5;

export function migrate(db: DatabaseSync): void {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;

    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sources (
      key TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      base_url TEXT NOT NULL,
      trust REAL NOT NULL DEFAULT 0.5,
      active INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY,
      source_key TEXT NOT NULL REFERENCES sources(key),
      url TEXT NOT NULL,
      fetched_at TEXT NOT NULL,
      http_status INTEGER,
      content_hash TEXT,
      UNIQUE(source_key, url, fetched_at)
    );
    CREATE INDEX IF NOT EXISTS idx_documents_url ON documents(url);

    CREATE TABLE IF NOT EXISTS raw_events (
      id INTEGER PRIMARY KEY,
      source_key TEXT NOT NULL REFERENCES sources(key),
      source_event_id TEXT NOT NULL,
      source_url TEXT NOT NULL,
      payload TEXT NOT NULL,          -- RawEvent JSON
      extracted_at TEXT NOT NULL,
      content_hash TEXT NOT NULL,     -- hash of payload for change detection
      UNIQUE(source_key, source_event_id)
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      description TEXT,
      category TEXT NOT NULL DEFAULT 'andet',
      venue_name TEXT,
      street TEXT,
      postcode TEXT,
      city TEXT,
      municipality TEXT,
      lat REAL,
      lng REAL,
      geocode_quality TEXT,
      organizer TEXT,
      contact_website TEXT,
      contact_email TEXT,
      contact_phone TEXT,
      price_text TEXT,
      is_free INTEGER,                -- 1/0/NULL
      stall_count_text TEXT,
      indoor_outdoor TEXT NOT NULL DEFAULT 'unknown',
      schedule_text TEXT,
      opening_hours_text TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      confidence REAL NOT NULL DEFAULT 0,
      field_provenance TEXT NOT NULL DEFAULT '{}',
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      search_text TEXT NOT NULL DEFAULT ''  -- ascii-folded shadow of searchable fields
    );
    CREATE INDEX IF NOT EXISTS idx_events_postcode ON events(postcode);
    CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);

    CREATE TABLE IF NOT EXISTS occurrences (
      id INTEGER PRIMARY KEY,
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      start_time TEXT,
      end_time TEXT,
      UNIQUE(event_id, date)
    );
    CREATE INDEX IF NOT EXISTS idx_occurrences_date ON occurrences(date);

    CREATE TABLE IF NOT EXISTS event_sources (
      event_id INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      raw_event_id INTEGER NOT NULL REFERENCES raw_events(id),
      first_linked_at TEXT NOT NULL,
      last_confirmed_at TEXT NOT NULL,
      PRIMARY KEY (event_id, raw_event_id)
    );

    -- Permanent second-hand venues (thrift/antique/flea shops) from OpenStreetMap.
    -- Deliberately SEPARATE from events: they have opening hours, not dates, so
    -- they must never enter the occurrence/confidence model. One row per OSM object.
    CREATE TABLE IF NOT EXISTS venues (
      id INTEGER PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      osm_type TEXT NOT NULL,             -- node | way | relation
      osm_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      category TEXT NOT NULL DEFAULT 'genbrug',  -- genbrug | antik | loppebutik | reolmarked
      street TEXT,
      postcode TEXT,
      city TEXT,
      municipality TEXT,
      lat REAL,
      lng REAL,
      opening_hours_text TEXT,            -- verbatim OSM opening_hours string
      contact_website TEXT,
      contact_phone TEXT,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'active',  -- active | gone
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      search_text TEXT NOT NULL DEFAULT '',
      UNIQUE(osm_type, osm_id)
    );
    CREATE INDEX IF NOT EXISTS idx_venues_status ON venues(status);
    CREATE INDEX IF NOT EXISTS idx_venues_category ON venues(category);

    -- INFORMAL PLACES — hidden/informal flea spots (private loppelader, gårdsalg,
    -- recurring garagesalg, dødsbo lagers, "åbent når flaget er ude").
    --
    -- A THIRD entity, deliberately neither an event nor a venue:
    --   * not an event — it has a HABIT, not dates. Forcing it into occurrences
    --     is the failure resolveSchedule's MAX_CONSECUTIVE_FILL already guards
    --     (a 24/7 private sale once became 30 daily markets).
    --   * not a venue — venues are OSM/chain businesses, corroborated by
    --     construction, so they carry no confidence and no provenance. A private
    --     barn known from one Facebook post needs both.
    --
    -- PRIVACY: street/lat/lng here are INTERNAL. address_visibility governs what
    -- may ever be published, and that is enforced in the data layer
    -- (packages/core informal-visibility.ts) — never in the UI, because on a
    -- static export anything serialized is public forever.
    CREATE TABLE IF NOT EXISTS informal_places (
      id INTEGER PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,          -- assigned once; never rewritten (URL stability)
      canonical_name TEXT NOT NULL,
      aliases TEXT NOT NULL DEFAULT '[]', -- JSON string[]
      place_type TEXT NOT NULL DEFAULT 'andet',
      description TEXT,
      street TEXT,                        -- INTERNAL — see address_visibility
      postcode TEXT,
      city TEXT,
      municipality TEXT,
      region TEXT,
      lat REAL,                           -- INTERNAL — blurred before publishing
      lng REAL,
      geo_precision TEXT NOT NULL DEFAULT 'unknown',   -- exact|street|postcode|area|unknown
      address_visibility TEXT NOT NULL DEFAULT 'omraade', -- cautious by default
      contact_name TEXT,
      phone TEXT,
      phone_norm TEXT,                    -- E.164-ish, for entity resolution
      email TEXT,
      facebook_url TEXT,
      website_url TEXT,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      last_verified_at TEXT,
      status TEXT NOT NULL DEFAULT 'unverified',
      recurrence TEXT,                    -- JSON InformalRecurrence
      opening_notes TEXT,
      call_before_visiting INTEGER NOT NULL DEFAULT 0,
      open_when_flag_is_out INTEGER NOT NULL DEFAULT 0,
      confidence INTEGER NOT NULL DEFAULT 0,  -- 0..100 "is it real?"  (own model)
      fund_score INTEGER NOT NULL DEFAULT 0,  -- 0..100 "worth the drive?" (own model)
      score_flags TEXT NOT NULL DEFAULT '{}', -- JSON reviewer/classifier flags
      price_level TEXT,                   -- lav | middel | hoej
      inventory_signals TEXT NOT NULL DEFAULT '[]', -- JSON InventorySignal[]
      image_urls TEXT NOT NULL DEFAULT '[]',
      merged_ids TEXT NOT NULL DEFAULT '[]',
      moderation_notes TEXT,              -- INTERNAL — never published
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_informal_status ON informal_places(status);
    CREATE INDEX IF NOT EXISTS idx_informal_type ON informal_places(place_type);
    CREATE INDEX IF NOT EXISTS idx_informal_phone ON informal_places(phone_norm);

    -- Provenance atoms. Never deleted: a place's whole story must stay
    -- reconstructible, and excerpt/verified_by are INTERNAL (the public view
    -- ships only type + url + date).
    CREATE TABLE IF NOT EXISTS informal_place_sources (
      id INTEGER PRIMARY KEY,
      place_id INTEGER NOT NULL REFERENCES informal_places(id) ON DELETE CASCADE,
      source_type TEXT NOT NULL,
      url TEXT,
      observed_at TEXT NOT NULL,
      excerpt TEXT,
      verified_by TEXT,
      raw_ref TEXT,                       -- optional pointer into raw_events/tips
      created_at TEXT NOT NULL,
      UNIQUE(place_id, source_type, url, observed_at)
    );
    CREATE INDEX IF NOT EXISTS idx_informal_sources_place ON informal_place_sources(place_id);

    -- Community visit reports. Signals, never votes — a single report may not
    -- flip a place's status (see informal-confidence.ts CLOSED_REPORT_QUORUM).
    CREATE TABLE IF NOT EXISTS informal_place_reports (
      id INTEGER PRIMARY KEY,
      place_id INTEGER NOT NULL REFERENCES informal_places(id) ON DELETE CASCADE,
      visited_at TEXT NOT NULL,
      was_open INTEGER,
      price_level TEXT,
      stock_level TEXT,
      fresh_stock INTEGER,
      seller_kind TEXT,
      negotiable INTEGER,
      categories TEXT NOT NULL DEFAULT '[]',
      worth_the_drive INTEGER,
      comment TEXT,
      reporter TEXT,
      reported_closed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_informal_reports_place ON informal_place_reports(place_id);

    CREATE TABLE IF NOT EXISTS geocode_cache (
      query TEXT PRIMARY KEY,
      lat REAL,
      lng REAL,
      quality TEXT,
      resolved_city TEXT,
      resolved_postcode TEXT,
      cached_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS source_candidates (
      domain TEXT PRIMARY KEY,              -- normalized hostname, no www.
      mentions INTEGER NOT NULL DEFAULT 0,  -- raw_events referencing this domain
      distinct_titles INTEGER NOT NULL DEFAULT 0,
      sources TEXT NOT NULL DEFAULT '[]',   -- JSON: source_keys that mentioned it
      fields TEXT NOT NULL DEFAULT '[]',    -- JSON: subset of ["contactWebsite","description"]
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'candidate', -- candidate | probed | promoted | rejected
      probe_score REAL,
      probe_signals TEXT,
      probed_at TEXT,
      notes TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_source_candidates_status ON source_candidates(status);

    CREATE TABLE IF NOT EXISTS tips (
      id INTEGER PRIMARY KEY,
      url TEXT,                 -- e.g. a facebook.com/events link
      text TEXT,                -- pasted announcement text
      contact TEXT,             -- optional submitter contact
      submitted_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'new'  -- new | processed | rejected
    );

    CREATE TABLE IF NOT EXISTS pipeline_runs (
      id INTEGER PRIMARY KEY,
      source_key TEXT,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      stats TEXT NOT NULL DEFAULT '{}'
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS events_fts USING fts5(
      title, venue_name, city, description, search_text,
      content='events', content_rowid='id',
      tokenize='unicode61 remove_diacritics 2'
    );

    CREATE TRIGGER IF NOT EXISTS events_fts_insert AFTER INSERT ON events BEGIN
      INSERT INTO events_fts(rowid, title, venue_name, city, description, search_text)
      VALUES (new.id, new.title, new.venue_name, new.city, new.description, new.search_text);
    END;
    CREATE TRIGGER IF NOT EXISTS events_fts_delete AFTER DELETE ON events BEGIN
      INSERT INTO events_fts(events_fts, rowid, title, venue_name, city, description, search_text)
      VALUES ('delete', old.id, old.title, old.venue_name, old.city, old.description, old.search_text);
    END;
    CREATE TRIGGER IF NOT EXISTS events_fts_update AFTER UPDATE ON events BEGIN
      INSERT INTO events_fts(events_fts, rowid, title, venue_name, city, description, search_text)
      VALUES ('delete', old.id, old.title, old.venue_name, old.city, old.description, old.search_text);
      INSERT INTO events_fts(rowid, title, venue_name, city, description, search_text)
      VALUES (new.id, new.title, new.venue_name, new.city, new.description, new.search_text);
    END;
  `);
  // Columns added after v1 shipped: CREATE TABLE IF NOT EXISTS won't add
  // them to existing databases, so patch them in explicitly.
  const eventColumns = new Set(
    (db.prepare(`PRAGMA table_info(events)`).all() as Array<{ name: string }>).map((c) => c.name),
  );
  if (!eventColumns.has('amenities')) {
    db.exec(`ALTER TABLE events ADD COLUMN amenities TEXT`);
  }

  // How many of a candidate's mined titles are already canonical — lets the
  // discovery report and the /kilder page separate a link to markets we already
  // have from a source that would add genuinely new ones.
  const candidateColumns = new Set(
    (db.prepare(`PRAGMA table_info(source_candidates)`).all() as Array<{ name: string }>).map(
      (c) => c.name,
    ),
  );
  if (!candidateColumns.has('covered_titles')) {
    db.exec(`ALTER TABLE source_candidates ADD COLUMN covered_titles INTEGER`);
  }

  // Same story for the score explanations: CREATE TABLE IF NOT EXISTS won't add
  // them to a database that already has informal_places.
  const informalColumns = new Set(
    (db.prepare(`PRAGMA table_info(informal_places)`).all() as Array<{ name: string }>).map(
      (c) => c.name,
    ),
  );
  if (informalColumns.size > 0 && !informalColumns.has('confidence_explain')) {
    db.exec(`ALTER TABLE informal_places ADD COLUMN confidence_explain TEXT`);
    db.exec(`ALTER TABLE informal_places ADD COLUMN fund_explain TEXT`);
  }

  db.prepare(
    `INSERT INTO meta(key, value) VALUES ('schema_version', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(String(SCHEMA_VERSION));
}
