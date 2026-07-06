/**
 * Røde Kors genbrug — ~260 charity shops. Unlike the other chains, the national
 * genbrug page embeds EVERY shop in one drupal-settings-json blob (`rk_maps`),
 * each with coordinates and a full address (no per-page crawl, no geocoding).
 * Clothing containers (category "container") are excluded — only "store".
 *
 * Feeds ingestChainVenues like the other chains; the shared dedup enriches an
 * OSM "Røde Kors" venue nearby rather than cloning it. Opening hours aren't in
 * the national blob (they live on per-department pages), so RK shops arrive
 * without hours — name/address/location is still a real coverage win.
 */
import { classifyVenue } from '@loppefund/core';
import type { ChainVenue } from '../chain-venues.ts';

const PAGE = 'https://www.rodekors.dk/genbrug/genbrugsbutikker';
const UA = 'Loppefund/1.0 (+https://jacobtop-tcg.github.io/loppefund; Danish flea-market directory)';
const OPERATOR = 'Røde Kors';
const OPERATOR_TOKEN = 'roede kors'; // folded "Røde Kors"

interface RkStore {
  category?: string;
  department?: string;
  location?: { lat?: string; lng?: string };
  address?: string[];
}

/** Stable numeric id from the shop's street+postcode (no id in the source). */
function stableId(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return h;
}

/** Parse the national genbrug page into Røde Kors shop venues. */
export function parseRodekorsShops(html: string): ChainVenue[] {
  const m = html.match(
    /<script[^>]*data-drupal-selector="drupal-settings-json"[^>]*>(.*?)<\/script>/s,
  );
  if (!m) return [];
  let settings: unknown;
  try {
    settings = JSON.parse(m[1]!);
  } catch {
    return [];
  }
  const maps = (settings as { rk_maps?: RkStore[][] }).rk_maps;
  if (!Array.isArray(maps)) return [];

  const out: ChainVenue[] = [];
  const seen = new Set<number>();
  for (const store of maps.flat()) {
    if (!store || store.category !== 'store') continue; // skip clothing containers
    const addr = store.address ?? [];
    const street = (addr[0] ?? '').trim();
    // The "0000 By" element — usually address[1], but scan defensively.
    const pcLine = addr.find((a) => /^\s*\d{4}\s+\S/.test(a ?? '')) ?? '';
    const pc = pcLine.match(/(\d{4})\s+(.+)/);
    if (!street || !pc) continue;
    const postcode = pc[1]!;
    const city = pc[2]!.trim();
    const lat = Number(store.location?.lat);
    const lng = Number(store.location?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    const sourceId = stableId(`${street}|${postcode}`);
    if (seen.has(sourceId)) continue; // guard duplicate rows
    seen.add(sourceId);

    const title = `${OPERATOR} Butik, ${city}`;
    out.push({
      sourceType: 'rk',
      sourceId,
      operatorToken: OPERATOR_TOKEN,
      title,
      category: classifyVenue({ name: title, operator: OPERATOR }),
      street,
      postcode,
      city,
      openingHoursText: null, // not in the national blob
      contactWebsite: PAGE,
      lat,
      lng,
    });
  }
  return out;
}

async function defaultFetchText(url: string): Promise<string> {
  // Per-request timeout so a hung page can't stall the crawl (one page here,
  // but consistent with the other chains and cheap insurance).
  const res = await globalThis.fetch(url, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.text();
}

/** Fetch every Røde Kors shop from the single national page (injectable). */
export async function fetchRodekorsVenues(
  opts: { fetchText?: (url: string) => Promise<string> } = {},
): Promise<ChainVenue[]> {
  const fetchText = opts.fetchText ?? defaultFetchText;
  return parseRodekorsShops(await fetchText(PAGE));
}
