/**
 * Adapter for loppebjornen.dk — LoppeBjørnen, an operator running several
 * Copenhagen-area markets (Ørestad, Københavns Længste, Ballerup, Lyngby,
 * Letbane-åbning). Each market DAY is sold as a WooCommerce product in the
 * "Loppemarked" category; the public WooCommerce Store API exposes them cleanly.
 * Table/chair rentals live in the "Borde"/"Stole" categories and are ignored.
 *
 * Dedicated operator source, trust 0.7. robots.txt only disallows cart/admin
 * paths. Dates come from the product name (or its short description when the
 * name omits the year); the address is the part after the last " / " in the
 * "Lokation:" line. Times mix opening and arrival hours in free text, so we
 * follow the project rule and never invent them — occurrences are date-only.
 */
import { parseDanishDate, type RawEvent } from '@loppefund/core';
import { decodeEntities, parseAddress } from './loppemarkeder-nu.ts';
import type { FetchFn, SourceAdapter } from './types.ts';

const BASE = 'https://loppebjornen.dk';
const PER_PAGE = 100;
const MAX_PAGES = 10;
const MARKET_CATEGORY = 'Loppemarked';
const MONTHS =
  'januar|februar|marts|april|maj|juni|juli|august|september|oktober|november|december';

interface WcProduct {
  id: number;
  name: string;
  permalink?: string;
  short_description?: string;
  categories?: Array<{ name?: string }>;
}

function clean(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
}

/** Every distinct "DD <month> YYYY" date in the text, as sorted ISO dates. */
function parseDates(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(new RegExp(`\\b\\d{1,2}\\.?\\s*(?:${MONTHS})\\s+\\d{4}\\b`, 'gi'))) {
    const iso = parseDanishDate(m[0]);
    if (iso) out.add(iso);
  }
  return [...out].sort();
}

export function productToRawEvent(p: WcProduct): RawEvent | null {
  if (!(p.categories ?? []).some((c) => c.name === MARKET_CATEGORY)) return null;
  const name = decodeEntities(p.name ?? '').trim();
  const sd = clean(p.short_description ?? '');

  // The market's own name carries the date; fall back to the description for
  // the rare product whose name omits the year (e.g. the Letbane opening).
  const dates = parseDates(name).length ? parseDates(name) : parseDates(sd);
  if (dates.length === 0) return null;

  const title =
    name.replace(new RegExp(`\\s*[–—-]?\\s*\\d{1,2}\\.?\\s*(?:${MONTHS})\\.?(?:\\s+\\d{4})?\\s*$`, 'i'), '').trim() ||
    name;

  const locRaw = sd
    .match(new RegExp(`Lokation:\\s*(.+?)(?:\\s*(?:Antal|Priser|Pris\\b|Dato og tid)|$)`, 'i'))?.[1]
    ?.trim();
  const addr = parseAddress(locRaw ? locRaw.split(/\s*\/\s*/).at(-1)!.trim() : undefined);

  return {
    sourceKey: 'loppebjornen',
    sourceUrl: p.permalink ?? BASE,
    sourceEventId: String(p.id),
    title,
    description: sd || undefined,
    category: 'loppemarked',
    street: addr.street,
    postcode: addr.postcode,
    city: addr.city,
    organizer: 'LoppeBjørnen',
    contactWebsite: `${BASE}/`,
    occurrences: dates.map((date) => ({ date, startTime: null, endTime: null })),
  };
}

export const loppebjornen: SourceAdapter = {
  key: 'loppebjornen',
  name: 'LoppeBjørnen',
  baseUrl: BASE,
  trust: 0.7,

  async discover(): Promise<string[]> {
    return []; // API-shaped source; see fetchRawEvents
  },

  extract(): RawEvent | null {
    return null;
  },

  async fetchRawEvents(fetch: FetchFn): Promise<RawEvent[]> {
    const out: RawEvent[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const res = await fetch(`${BASE}/wp-json/wc/store/v1/products?per_page=${PER_PAGE}&page=${page}`);
      if (res.status !== 200) break;
      let products: WcProduct[];
      try {
        products = JSON.parse(res.body);
      } catch {
        break;
      }
      if (!Array.isArray(products)) break;
      for (const p of products) {
        const raw = productToRawEvent(p);
        if (raw) out.push(raw);
      }
      if (products.length < PER_PAGE) break;
    }
    return out;
  },
};
