/**
 * oplevelser-i-koebenhavn.dk — a greater-Copenhagen "what's on" portal running
 * WordPress + The Events Calendar, the same REST API as loppemarkeder.nu. It's a
 * general events site, so we fetch ONLY the market categories (loppemarked +
 * julemarked) — ~113 loppemarkeder for the capital region, where it's strong
 * (Toftegårds Plads, Frederiksberg Loppetorv, Vanløse Torv, Veras Market, …).
 *
 * Found automatically by the web-search source-discovery sweep. robots.txt allows
 * the wp-json route. Reuses loppemarkeder.nu's Tribe helpers.
 */
import { normalizeCategory, type RawEvent } from '@loppefund/core';
import type { FetchFn, SourceAdapter } from './types.ts';
import {
  decodeEntities,
  parseAddress,
  stripHtml,
  toOccurrences,
  type TribeEvent,
} from './loppemarkeder-nu.ts';

const BASE = 'https://oplevelser-i-koebenhavn.dk';
const PER_PAGE = 50;
const MAX_PAGES = 12;
// Only the market slices of this general portal — never its concerts/theatre/etc.
const CATEGORIES = ['loppemarked', 'julemarked'];

function toRaw(e: TribeEvent): RawEvent {
  const venueObj = Array.isArray(e.venue) ? e.venue[0] : e.venue;
  const addr = parseAddress(venueObj?.address ?? venueObj?.venue);
  const categorySlug = e.categories?.map((c) => c.slug ?? c.name).join(' ');
  const cost = e.cost ? decodeEntities(e.cost) : undefined;
  return {
    sourceKey: 'oplevelser-kbh',
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

export const oplevelserKbh: SourceAdapter = {
  key: 'oplevelser-kbh',
  name: 'Oplevelser i København',
  baseUrl: BASE,
  // Curated regional portal on a structured API — solid, a touch below the
  // dedicated national calendars.
  trust: 0.55,

  async discover(): Promise<string[]> {
    return []; // API-shaped source; see fetchRawEvents
  },
  extract(): RawEvent | null {
    return null;
  },

  async fetchRawEvents(fetch: FetchFn): Promise<RawEvent[]> {
    const seen = new Set<string>();
    const out: RawEvent[] = [];
    for (const category of CATEGORIES) {
      for (let page = 1; page <= MAX_PAGES; page++) {
        const url = `${BASE}/wp-json/tribe/events/v1/events?per_page=${PER_PAGE}&page=${page}&categories=${category}`;
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
          const key = String(e.id);
          if (seen.has(key)) continue; // an event tagged both categories
          seen.add(key);
          out.push(toRaw(e));
        }
        if (events.length < PER_PAGE || page >= (data.total_pages ?? 1)) break;
      }
    }
    return out;
  },
};
