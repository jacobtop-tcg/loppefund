import 'server-only';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { addDays, isHiddenGem, searchFold } from '@loppefund/core';
import { getEventBySlug, listEventsBetween, openDb } from '@loppefund/db';

let db: DatabaseSync | null = null;

function resolveDbPath(): string {
  if (process.env.LOPPEFUND_DB) return process.env.LOPPEFUND_DB;
  // Walk up from cwd until we find data/loppefund.db (monorepo root).
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, 'data', 'loppefund.db');
    if (existsSync(candidate)) return candidate;
    dir = dirname(dir);
  }
  return join(process.cwd(), 'data', 'loppefund.db');
}

function getDb(): DatabaseSync {
  db ??= openDb(resolveDbPath());
  return db;
}

export interface EventSummary {
  slug: string;
  title: string;
  category: string;
  venueName: string | null;
  city: string | null;
  postcode: string | null;
  municipality: string | null;
  lat: number | null;
  lng: number | null;
  isFree: boolean | null;
  indoorOutdoor: string;
  stallCountText: string | null;
  status: string;
  confidence: number;
  /** Hidden-gem heuristic — see @loppefund/core gems.ts. */
  gem: boolean;
  /** Folded description snippet so client search can match e.g. "vintage". */
  searchText: string;
  occurrences: Array<{ date: string; startTime: string | null; endTime: string | null }>;
}

export function todayIso(): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Copenhagen' }).format(new Date());
}

export function listUpcomingEvents(horizonDays = 120): EventSummary[] {
  const from = todayIso();
  const to = addDays(from, horizonDays);
  return listEventsBetween(getDb(), from, to)
    .map((e) => ({
      slug: e.slug,
      title: e.title,
      category: e.category,
      venueName: e.venue_name,
      city: e.city,
      postcode: e.postcode,
      municipality: e.municipality,
      lat: e.lat,
      lng: e.lng,
      isFree: e.is_free === null ? null : e.is_free === 1,
      indoorOutdoor: e.indoor_outdoor,
      stallCountText: e.stall_count_text,
      status: e.status,
      confidence: e.confidence,
      gem: isHiddenGem({
        confidence: e.confidence,
        sourceCount: e.source_count,
        occurrenceCount: e.occurrences.length,
        hasLocation: e.lat != null && e.lng != null,
        descriptionLength: e.description?.length ?? 0,
        stallCountText: e.stall_count_text,
        isFreeKnown: e.is_free !== null,
        hasTimedOccurrence: e.occurrences.some((o) => o.start_time !== null),
        hasVenueName: e.venue_name !== null,
        hasOrganizerOrWebsite: e.organizer !== null || e.contact_website !== null,
      }),
      searchText: e.description ? searchFold(e.description).slice(0, 400) : '',
      // Cap the serialized occurrence list — always-open venues have one per
      // day, which bloats the payload without changing filter results.
      occurrences: e.occurrences.slice(0, 40).map((o) => ({
        date: o.date,
        startTime: o.start_time,
        endTime: o.end_time,
      })),
    }))
    .sort((a, b) => (a.occurrences[0]?.date ?? '').localeCompare(b.occurrences[0]?.date ?? ''));
}

export function loadEventDetail(slug: string) {
  const e = getEventBySlug(getDb(), slug);
  if (!e) return null;
  return {
    slug: e.slug,
    title: e.title,
    description: e.description,
    category: e.category,
    venueName: e.venue_name,
    street: e.street,
    postcode: e.postcode,
    city: e.city,
    municipality: e.municipality,
    lat: e.lat,
    lng: e.lng,
    organizer: e.organizer,
    contactWebsite: e.contact_website,
    contactEmail: e.contact_email,
    contactPhone: e.contact_phone,
    priceText: e.price_text,
    isFree: e.is_free === null ? null : e.is_free === 1,
    stallCountText: e.stall_count_text,
    indoorOutdoor: e.indoor_outdoor,
    scheduleText: e.schedule_text,
    openingHoursText: e.opening_hours_text,
    status: e.status,
    confidence: e.confidence,
    lastSeenAt: e.last_seen_at,
    occurrences: e.occurrences.map((o) => ({
      date: o.date,
      startTime: o.start_time,
      endTime: o.end_time,
    })),
    sources: e.sources.map((s) => ({
      name: s.name,
      url: s.source_url,
      lastConfirmedAt: s.last_confirmed_at,
    })),
  };
}
