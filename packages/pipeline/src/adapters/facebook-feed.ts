/**
 * Fully automated ingestion of Facebook content via a scraping vendor.
 *
 * We deliberately do NOT crawl Facebook ourselves — login-walled scraping
 * gets accounts banned and would put the whole "living database" at risk.
 * Instead, vendor actors (scheduled vendor-side, e.g. on Apify) harvest the
 * three surfaces and expose JSON datasets; we pull those feeds and let the
 * trust model do its job: feed events enter at low trust and rise through
 * corroboration or freshness.
 *
 * The three Facebook surfaces, in priority order:
 *  1. EVENTS  — actor searches "loppemarked/kræmmermarked/…" per city;
 *     items carry machine dates + coordinates → mapped directly (eventToRaw).
 *  2. GROUPS  — actor scrapes configured groups (open ones tokenless; closed
 *     ones need member-account cookies vendor-side); informal post text goes
 *     through the announcement parser (parseTip).
 *  3. MARKETPLACE — same text path; the parser's hard date requirement
 *     naturally discards item-for-sale noise.
 *
 * Configuration (either or both):
 *   APIFY_TOKEN + APIFY_ACTORS  derive last-run dataset URLs automatically:
 *     https://api.apify.com/v2/acts/<actor>/runs/last/dataset/items?...
 *     APIFY_ACTORS is a comma list, default covers the events+groups actors.
 *   LOPPEFUND_FB_FEED_URLS      explicit dataset URLs (any vendor).
 *
 * Ready-to-paste actor inputs (query × region matrices) live in apify/.
 */
import { createHash } from 'node:crypto';
import { copenhagenNow, extractPostcode, type Occurrence, type RawEvent } from '@loppefund/core';
import type { FetchFn, SourceAdapter } from './types.ts';
import { parseTip } from '../tip-parser.ts';
import { looksLikeMarket } from './kultunaut.ts';

interface FeedLocation {
  name?: string;
  address?: string;
  city?: string;
  latitude?: number;
  longitude?: number;
}

interface FeedItem {
  id?: string | number;
  postId?: string | number;
  text?: string;
  postText?: string;
  message?: string;
  url?: string;
  postUrl?: string;
  facebookUrl?: string;
  eventUrl?: string;
  // Facebook-event shape (events actor)
  name?: string;
  description?: string;
  startTimestamp?: number; // unix seconds
  endTimestamp?: number;
  startDate?: string; // ISO
  endDate?: string;
  utcStartDate?: string;
  utcEndDate?: string;
  location?: FeedLocation | string;
  place?: FeedLocation | string;
  isCanceled?: boolean;
  canceled?: boolean;
}

const DEFAULT_ACTORS = 'apify~facebook-events-scraper,apify~facebook-groups-scraper';

export function feedUrls(env: NodeJS.ProcessEnv = process.env): string[] {
  const explicit = (env.LOPPEFUND_FB_FEED_URLS ?? '')
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean);
  const token = env.APIFY_TOKEN?.trim();
  if (!token) return explicit;
  const derived = (env.APIFY_ACTORS ?? DEFAULT_ACTORS)
    .split(',')
    .map((a) => a.trim())
    .filter(Boolean)
    .map(
      (actor) =>
        `https://api.apify.com/v2/acts/${actor}/runs/last/dataset/items?token=${token}&status=SUCCEEDED&clean=true`,
    );
  return [...explicit, ...derived];
}

function toDanishDateTime(item: { ts?: number; iso?: string }): { date: string; time: string } | null {
  const d = item.ts ? new Date(item.ts * 1000) : item.iso ? new Date(item.iso) : null;
  if (!d || Number.isNaN(d.getTime())) return null;
  return copenhagenNow(d);
}

/** "Havnevej 3, 5700 Svendborg"-ish address string -> parts. */
function splitAddress(address: string | undefined): {
  street?: string;
  postcode?: string;
  city?: string;
} {
  if (!address) return {};
  const postcode = extractPostcode(address) ?? undefined;
  const parts = address.split(',').map((p) => p.trim()).filter(Boolean);
  const street = parts[0];
  const tail = parts.slice(1).join(' ');
  const city =
    tail.replace(/\b[1-9]\d{3}\b/, '').replace(/Danmark|Denmark/gi, '').trim() || undefined;
  return { street, postcode, city };
}

/**
 * A Facebook EVENT carries machine dates (and usually coordinates) — map it
 * directly instead of re-parsing prose. Only market-signalled events pass.
 */
export function eventToRaw(item: FeedItem, refDate: string): RawEvent | null {
  if (!item.name) return null;
  const start = toDanishDateTime({ ts: item.startTimestamp, iso: item.startDate ?? item.utcStartDate });
  if (!start) return null;
  if (!looksLikeMarket(item.name, item.description)) return null;

  const end = toDanishDateTime({ ts: item.endTimestamp, iso: item.endDate ?? item.utcEndDate });
  const occurrences: Occurrence[] = [];
  let day = start.date;
  const lastDay = end && end.date >= start.date ? end.date : start.date;
  for (let i = 0; day <= lastDay && i < 30; i++) {
    occurrences.push({
      date: day,
      startTime: day === start.date ? start.time : null,
      endTime: end && day === end.date ? end.time : null,
    });
    const [y, m, d] = day.split('-').map(Number) as [number, number, number];
    day = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  }
  if (!occurrences.some((o) => o.date >= refDate)) return null;

  const loc = typeof item.location === 'string' ? { name: item.location } : (item.location ?? {});
  const place = typeof item.place === 'string' ? { name: item.place } : (item.place ?? {});
  const where: FeedLocation = { ...place, ...loc };
  const addr = splitAddress(where.address);
  const id = item.id ?? createHash('sha256').update(item.name + start.date).digest('hex').slice(0, 16);

  return {
    sourceKey: 'facebook-feed',
    sourceUrl: item.eventUrl ?? item.url ?? `fbevent:${id}`,
    sourceEventId: `fbevent-${id}`,
    title: item.name.trim(),
    description: item.description?.trim() || undefined,
    category: undefined, // canonicalizer derives from title via normalizeCategory
    venueName: where.name,
    street: addr.street,
    postcode: addr.postcode,
    city: addr.city ?? where.city,
    lat: where.latitude,
    lng: where.longitude,
    occurrences,
    cancelled: item.isCanceled || item.canceled || undefined,
  };
}

export function itemToRaw(item: FeedItem, refDate: string): RawEvent | null {
  // Event-shaped items (machine dates) take the high-fidelity path.
  if (item.name && (item.startTimestamp || item.startDate || item.utcStartDate)) {
    return eventToRaw(item, refDate);
  }
  const text = item.text ?? item.postText ?? item.message ?? null;
  const url = item.url ?? item.postUrl ?? item.facebookUrl ?? null;
  const id =
    item.id ?? item.postId ?? (text ? createHash('sha256').update(text).digest('hex').slice(0, 16) : null);
  if (!id) return null;
  return parseTip({ id, url, text }, refDate, { key: 'facebook-feed', idPrefix: 'fb' });
}

export const facebookFeed: SourceAdapter = {
  key: 'facebook-feed',
  name: 'Facebook',
  baseUrl: 'https://www.facebook.com',
  // Announcements come straight from organizers, but automated parsing of
  // informal posts earns only cautious trust.
  trust: 0.4,

  async discover(): Promise<string[]> {
    return [];
  },

  extract(): RawEvent | null {
    return null;
  },

  async fetchRawEvents(fetch: FetchFn): Promise<RawEvent[]> {
    const urls = feedUrls();
    if (urls.length === 0) {
      console.log(
        '[facebook-feed] ingen feeds konfigureret — sæt APIFY_TOKEN eller LOPPEFUND_FB_FEED_URLS (se adapterens doc-kommentar)',
      );
      return [];
    }
    const refDate = new Date().toISOString().slice(0, 10);
    const out: RawEvent[] = [];
    for (const url of urls) {
      const res = await fetch(url);
      if (res.status !== 200) {
        console.log(`[facebook-feed] feed svarede ${res.status}: ${url.split('?')[0]}`);
        continue;
      }
      let items: FeedItem[];
      try {
        const parsed = JSON.parse(res.body) as FeedItem[] | { items?: FeedItem[] };
        items = Array.isArray(parsed) ? parsed : (parsed.items ?? []);
      } catch {
        console.log(`[facebook-feed] ugyldig JSON fra ${url.split('?')[0]}`);
        continue;
      }
      for (const item of items) {
        const raw = itemToRaw(item, refDate);
        if (raw) out.push(raw);
      }
    }
    return out;
  },
};
