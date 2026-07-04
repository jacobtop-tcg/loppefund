/**
 * Adapter for loppemarkeder.nu — WordPress site using The Events Calendar,
 * which exposes a clean public REST API. ~700 upcoming events.
 * robots.txt allows everything except /wp-admin/.
 */
import {
  extractPostcode,
  normalizeCategory,
  type Occurrence,
  type RawEvent,
} from '@loppefund/core';
import type { FetchFn, SourceAdapter } from './types.ts';

const BASE = 'https://loppemarkeder.nu';
const PER_PAGE = 50;
const MAX_PAGES = 40;

/** Decode numeric and the common named HTML entities WP emits. */
export function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>');
}

export function stripHtml(html: string): string {
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n\n')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export interface TribeEvent {
  id: number;
  title: string;
  description?: string;
  url: string;
  start_date: string; // "2026-07-02 12:00:00" local
  end_date: string;
  all_day: boolean;
  cost?: string;
  website?: string;
  categories?: Array<{ slug?: string; name?: string }>;
  venue?: { venue?: string; address?: string } | Array<{ venue?: string; address?: string }>;
}

/** "Brusagervej 1, 4070 Kirke Hyllinge, Danmark" -> parts */
export function parseAddress(text: string | undefined): {
  street?: string;
  postcode?: string;
  city?: string;
} {
  if (!text) return {};
  const cleaned = decodeEntities(text).replace(/,?\s*(Danmark|Denmark)\s*/gi, '');
  const postcode = extractPostcode(cleaned) ?? undefined;
  // Venue strings repeat segments ("6640 Lunderskov, 6640 Lunderskov") — dedupe.
  const parts = [...new Set(cleaned.split(',').map((p) => p.trim()).filter(Boolean))];
  const street = parts[0] || undefined;
  let city: string | undefined;
  for (const p of parts.slice(1)) {
    const candidate = p.replace(/\b[1-9]\d{3}\b/, '').trim();
    // A city name is letters only (incl. æøå) and reasonably short —
    // reject leftovers like "Kovej, Torvet, Nørregade" or "på Banevej".
    if (
      candidate &&
      candidate.length <= 40 &&
      /^[a-zA-ZæøåÆØÅé.\- ]+$/.test(candidate) &&
      !/^(på|ved|i|bag)\s/i.test(candidate)
    ) {
      city = candidate;
      break;
    }
  }
  return { street, postcode, city };
}

/** Per-day occurrences from local "YYYY-MM-DD HH:MM:SS" start/end. */
export function toOccurrences(e: TribeEvent): Occurrence[] {
  const startDate = e.start_date.slice(0, 10);
  const endDate = e.end_date?.slice(0, 10) || startDate;
  const startTime = e.all_day ? null : e.start_date.slice(11, 16);
  const endTime = e.all_day ? null : e.end_date?.slice(11, 16) ?? null;
  const out: Occurrence[] = [];
  let d = startDate;
  for (let i = 0; d <= endDate && i < 60; i++) {
    out.push({ date: d, startTime, endTime });
    const [y, m, day] = d.split('-').map(Number) as [number, number, number];
    d = new Date(Date.UTC(y, m - 1, day + 1)).toISOString().slice(0, 10);
  }
  return out;
}

export function tribeEventToRaw(e: TribeEvent): RawEvent {
  const venueObj = Array.isArray(e.venue) ? e.venue[0] : e.venue;
  const addr = parseAddress(venueObj?.address ?? venueObj?.venue);
  const categorySlug = e.categories?.map((c) => c.slug ?? c.name).join(' ');
  const cost = e.cost ? decodeEntities(e.cost) : undefined;
  return {
    sourceKey: 'loppemarkeder-nu',
    sourceUrl: e.url,
    sourceEventId: String(e.id),
    title: decodeEntities(e.title).trim(),
    description: e.description ? stripHtml(e.description) : undefined,
    category: normalizeCategory(categorySlug || e.title),
    street: addr.street,
    postcode: addr.postcode,
    city: addr.city,
    contactWebsite: e.website || undefined,
    priceText: cost,
    isFree: cost ? /gratis|free|^0/i.test(cost) : undefined,
    occurrences: toOccurrences(e),
  };
}

export const loppemarkederNu: SourceAdapter = {
  key: 'loppemarkeder-nu',
  name: 'Loppemarkeder.nu',
  baseUrl: BASE,
  trust: 0.6,

  async discover(): Promise<string[]> {
    return []; // API-shaped source; see fetchRawEvents
  },

  extract(): RawEvent | null {
    return null;
  },

  async fetchRawEvents(fetch: FetchFn): Promise<RawEvent[]> {
    const out: RawEvent[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const url = `${BASE}/wp-json/tribe/events/v1/events?per_page=${PER_PAGE}&page=${page}`;
      const res = await fetch(url);
      if (res.status !== 200) break;
      let data: { events?: TribeEvent[]; total_pages?: number };
      try {
        data = JSON.parse(res.body);
      } catch {
        break;
      }
      const events = data.events ?? [];
      for (const e of events) {
        if (!e.title || !e.start_date) continue;
        out.push(tribeEventToRaw(e));
      }
      if (events.length < PER_PAGE || page >= (data.total_pages ?? 1)) break;
    }
    return out;
  },
};
