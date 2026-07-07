/**
 * Røde Kors genbrug — ~260 charity shops. The national genbrug page embeds EVERY
 * shop in one drupal-settings-json blob (`rk_maps`), each with coordinates, a
 * full address AND its own department-page URL (`/afdelinger/<slug>`). Clothing
 * containers (category "container") are excluded — only "store".
 *
 * OPENING HOURS: NOT available per shop. Verified against live pages (2026-07):
 * a department page's only "<h4>Åbningstider:</h4>" block sits inside the shared
 * national <address> (CVR 20700211) and is BYTE-IDENTICAL across every shop —
 * "Man-tors 8.30-16.00; Fredag 8.30-15.00; Lørdag Lukket". Those are the national
 * contact-centre hours, not the individual shop's (a genbrugsbutik is open
 * Saturdays; the office isn't). So we deliberately do NOT scrape them: stamping
 * identical office hours onto 260 shops would be wrong data, and "missing is
 * acceptable, incorrect is not". RK shops therefore arrive without hours (the
 * shared dedup can still enrich a matched OSM "Røde Kors" venue that has them).
 * contactWebsite points at the shop's OWN department page, which is more useful
 * than the national list.
 */
import { classifyVenue } from '@loppefund/core';
import type { ChainVenue } from '../chain-venues.ts';

const ORIGIN = 'https://www.rodekors.dk';
const PAGE = `${ORIGIN}/genbrug/genbrugsbutikker`;
const UA = 'Loppefund/1.0 (+https://jacobtop-tcg.github.io/loppefund; Danish flea-market directory)';
const OPERATOR = 'Røde Kors';
const OPERATOR_TOKEN = 'roede kors'; // folded "Røde Kors"

interface RkStore {
  category?: string;
  department?: string;
  location?: { lat?: string; lng?: string };
  address?: string[];
  /** "/afdelinger/<slug>" — the shop's own page. */
  url?: string;
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

    // Link the shop's OWN department page when present — more useful than the
    // national list. (Hours aren't scraped from it — see the file header.)
    const deptUrl =
      typeof store.url === 'string' && store.url.startsWith('/') ? `${ORIGIN}${store.url}` : null;
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
      openingHoursText: null, // RK publishes no trustworthy per-shop hours
      contactWebsite: deptUrl ?? PAGE,
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
