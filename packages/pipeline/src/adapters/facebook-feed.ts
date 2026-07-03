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
 *   LOPPEFUND_FB_FEED_URLS      comma list of feed sources — each either an
 *     HTTP(S) dataset URL (any vendor) OR a local file path (e.g.
 *     data/fb-harvest.json committed by the self-hosted scripts/fb-harvest.mjs).
 *
 * Ready-to-paste actor inputs (query × region matrices) live in apify/.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
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

function toDanishDateTime(item: { ts?: number; iso?: string }): { date: string; time: string | null } | null {
  // A date-only value ("2026-11-01", no time) means the time is genuinely unknown.
  // Keep it timeless instead of inventing midnight — which would also silently
  // shift across a DST boundary (a Nov date tagged +02:00 would read an hour off).
  if (item.iso && /^\d{4}-\d{2}-\d{2}$/.test(item.iso.trim())) {
    return { date: item.iso.trim(), time: null };
  }
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

// Facebook/OCR "chrome": UI text and scrape artefacts that get glued onto a
// poster's real words — the search bar, the author + timestamp line, group-nav
// items, reaction counts, and OCR mis-reads of "Facebook" ("ebook"/"ook"). Left
// in, they become the title or fool the date scanner (e.g. "8:11PM" → a date).
// Stripped so the market text stands alone. Applied ONLY to Facebook posts;
// community tips are pasted clean and go through the parser untouched.
const FB_CHROME: readonly RegExp[] = [
  /\bq?\s*search facebook\b/gi,
  /\bgruppen\b/gi,
  /\bpublic group\b/gi,
  /\b[\d.,]+\s*k?\s*members\b/gi,
  /\b(?:invite|ahout|about|discussion|people|media|files|joined)\b/gi,
  /\brising contributor\b/gi,
  /\b[A-Za-zÆØÅæøå]+\s+\d{1,2}\s+at\s+\d{1,2}[:.]\d{2}\s*[ap]m\b/gi, // "July 2 at 8:11PM"
  /\b\d{1,2}[:.]\d{2}\s*[ap]m\b/gi,
  /(?:^|\s)[·•*]\s*-?\s*\d+(?=\s|$)/g, // "• 0", "•0", "-0", "* 0" reaction counts
  /(?:^|\s)\d{1,2}\s*[hdwm](?=\s*[·•\-o*])/gi, // "4h" before a bullet/reaction
  /(?:^|\s)e?book(?=\s|$)/gi, // "ebook"/"book" — OCR of "Facebook"
  /(?:^|\s)ook(?=\s)/gi, // "ook" OCR fragment
  /[·•]\s*share\b/gi,
];

// A title that still reads as Facebook chrome after cleaning — never a market.
const CHROME_TITLE = /contributor|facebook|public group|members|discussion|^search\b/i;

export function stripFbChrome(text: string): string {
  let t = ` ${text} `;
  for (const re of FB_CHROME) t = t.replace(re, ' ');
  t = t.replace(/\s+/g, ' ').trim();
  return t.replace(/^[^\p{L}\p{N}]+/u, '').trim(); // drop leading emoji/symbols
}

// OCR of a poster routinely glues a weekday/date/year into what the parser
// reads as the "street", and surfaces stray 4-digit numbers that look like
// postcodes. On a low-trust source a wrong pin is worse than none, so keep
// location only when it's clearly an address: drop a street carrying date/
// weekday/year noise, and drop a postcode with no town name beside it (parseTip
// leaves `city` unset in that case — a bare number, not a confirmed postal town).
// A real street is "Navn <husnr>"; OCR instead hands us venue names with a date
// fragment ("Nødebo Kro Den 23"), holidays ("Grundlovsdag 5") or the market word
// itself ("Loppemarked d. 4"). Any of these tokens means it isn't an address.
const STREET_NOISE =
  /\b(?:mandag|tirsdag|onsdag|torsdag|fredag|lørdag|søndag)\b|\bden\b|\bd\.\s*\d|\bkl\.?\s*\d|\b\d{4}\b|\b(?:januar|februar|marts|april|maj|juni|juli|august|september|oktober|november|december)\b|(?:loppe|kr(?:æ|ae)mmer|genbrug|bazar|grundlovs|byfest|marked)/i;
// A postal town is one or two capitalised words; guard against a 4-digit YEAR
// read as a postcode next to an org name ("2026 Fyens Stiftstidende").
const CITY_OK = /^[A-ZÆØÅ][a-zæøåé]+(?:[ -][A-ZÆØÅa-zæøå]+){0,2}$/;
const CITY_BAD = /stiftstidende|avis|posten|tidende|nyheder|facebook/i;
function sanitizeFbLocation(raw: RawEvent): RawEvent {
  const street = raw.street && STREET_NOISE.test(raw.street) ? undefined : raw.street;
  const cityOk = !!raw.city && CITY_OK.test(raw.city) && !CITY_BAD.test(raw.city);
  const postcode = raw.postcode && cityOk ? raw.postcode : undefined;
  return { ...raw, street, postcode, city: postcode ? raw.city : undefined };
}

export function itemToRaw(item: FeedItem, refDate: string): RawEvent | null {
  // Event-shaped items (machine dates) take the high-fidelity path.
  if (item.name && (item.startTimestamp || item.startDate || item.utcStartDate)) {
    return eventToRaw(item, refDate);
  }
  const rawText = item.text ?? item.postText ?? item.message ?? null;
  const text = rawText ? stripFbChrome(rawText) : null;
  const url = item.url ?? item.postUrl ?? item.facebookUrl ?? null;
  // Hash the ORIGINAL text so the id is stable regardless of cleaning tweaks.
  const id =
    item.id ?? item.postId ?? (rawText ? createHash('sha256').update(rawText).digest('hex').slice(0, 16) : null);
  if (!id) return null;
  // A post with no market vocabulary at all (a "who's coming?" comment or pure
  // group navigation) is not an event — don't let the parser guess one.
  if (text && !looksLikeMarket(text)) return null;
  const raw = parseTip({ id, url, text }, refDate, { key: 'facebook-feed', idPrefix: 'fb' });
  if (!raw) return null;
  // Reject a draft whose title is still chrome the cleaner missed — better no
  // event than "*Rising contributor" or "ebook" showing up as a market.
  if (CHROME_TITLE.test(raw.title)) return null;
  return sanitizeFbLocation(raw);
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
      // A feed entry can be an HTTP(S) dataset URL (vendor/raw) OR a local file
      // path. The local path is the robust CI default: the harvested JSON is
      // committed to the repo, so the crawl reads it straight from the checkout —
      // no network round-trip, no CDN cache lag, always in lock-step with what
      // was just pushed.
      let body: string;
      if (/^https?:\/\//i.test(url)) {
        const res = await fetch(url);
        if (res.status !== 200) {
          console.log(`[facebook-feed] feed svarede ${res.status}: ${url.split('?')[0]}`);
          continue;
        }
        body = res.body;
      } else {
        try {
          body = await readFile(url, 'utf8');
        } catch {
          console.log(`[facebook-feed] kunne ikke læse lokal feed-fil: ${url}`);
          continue;
        }
      }
      let items: FeedItem[];
      try {
        const parsed = JSON.parse(body) as FeedItem[] | { items?: FeedItem[] };
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
