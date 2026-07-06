/**
 * Kirkens Korshær genbrug — the ~235 charity second-hand shops the chain lists
 * on its own site, with per-shop addresses AND opening hours (which OSM lacks).
 *
 * Source: https://kirkenskorshaer.dk — robots allows all; a dedicated
 * genbrugsbutik-sitemap.xml enumerates every shop page. Each page carries the
 * name (<h1>), a map-pin address line ("Street No, 0000 By") and a weekday
 * opening-hours table (.work-row rows). No JSON-LD/coordinates, so addresses are
 * forward-geocoded (DAWA) downstream. Feeds ingestChainVenues, which dedupes
 * against OSM (enriching the one Rudkøbing shop OSM already has with its hours).
 */
import { classifyVenue } from '@loppefund/core';
import type { ChainVenue } from '../chain-venues.ts';

const SITEMAP = 'https://kirkenskorshaer.dk/genbrugsbutik-sitemap.xml';
const UA = 'Loppefund/1.0 (+https://jacobtop-tcg.github.io/loppefund; Danish flea-market directory)';
const OPERATOR = 'Kirkens Korshær';
const OPERATOR_TOKEN = 'korshaer'; // folded — must appear in an OSM venue to merge

const DA_DAYS = ['Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag', 'Søndag'];
const OSM_DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'];

/** Turn the weekday→time map into a compact OSM opening_hours string, grouping
 *  consecutive same-hours days ("Tu-Fr 10:00-17:00; Sa 10:00-13:00"). Closed
 *  days ("Lukket") are omitted. Returns null when nothing is open. */
export function toOsmHours(byDay: Record<string, string>): string | null {
  const norm = (i: number): string | null => {
    const t = byDay[DA_DAYS[i]!];
    if (!t || /lukket/i.test(t)) return null;
    const cleaned = t.replace(/\s*[–—-]\s*/g, '-').replace(/\s*\/\s*/g, ',').replace(/\s+/g, '');
    // Only accept HH:MM-HH:MM shapes; anything odd is dropped (missing > wrong).
    return /^\d{1,2}:\d{2}-\d{1,2}:\d{2}(,\d{1,2}:\d{2}-\d{1,2}:\d{2})*$/.test(cleaned) ? cleaned : null;
  };
  const parts: string[] = [];
  let i = 0;
  while (i < 7) {
    const h = norm(i);
    if (h === null) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < 7 && norm(j + 1) === h) j++;
    parts.push(`${i === j ? OSM_DAYS[i] : `${OSM_DAYS[i]}-${OSM_DAYS[j]}`} ${h}`);
    i = j + 1;
  }
  return parts.length ? parts.join('; ') : null;
}

/** Parse one shop page into a ChainVenue, or null if it lacks a usable address. */
export function parseKkShop(html: string, url: string): ChainVenue | null {
  const idM = url.match(/genbrug-(\d+)\/?$/);
  if (!idM) return null;
  const sourceId = Number(idM[1]);

  const title = html.match(/<h1[^>]*>([^<]+)<\/h1>/)?.[1]?.trim();
  if (!title) return null;

  // Address text sits inside the map-pin anchor: "Nørrebro 40, 5900 Rudkøbing".
  const addr = html
    .match(/feather-map-pin[\s\S]{0,240}?<\/svg>\s*([^<]+?)\s*<\/a>/)?.[1]
    ?.replace(/\s+/g, ' ')
    .trim();
  const am = addr?.match(/^(.*?),\s*(\d{4})\s+(.+)$/);
  if (!am) return null; // no parseable address → can't place it → skip
  const street = am[1]!.trim();
  const postcode = am[2]!;
  const city = am[3]!.trim();

  const byDay: Record<string, string> = {};
  for (const m of html.matchAll(
    /<div class="work-row"><span class="name">([^<:]+):?<\/span><span class="name-time">([^<]+)<\/span>/g,
  )) {
    byDay[m[1]!.trim()] = m[2]!.trim();
  }

  return {
    sourceType: 'kk',
    sourceId,
    operatorToken: OPERATOR_TOKEN,
    title,
    category: classifyVenue({ name: title, operator: OPERATOR }),
    street,
    postcode,
    city,
    openingHoursText: toOsmHours(byDay),
    contactWebsite: url,
  };
}

async function defaultFetchText(url: string): Promise<string> {
  const res = await globalThis.fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.text();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Fetch every Kirkens Korshær shop from the sitemap. `fetchText` is injectable
 * for offline tests; `delayMs` paces the ~235 page fetches politely (identifying
 * User-Agent, one request at a time). A single page that fails is skipped, never
 * fatal — partial coverage beats none.
 */
export async function fetchKirkensKorshaerVenues(
  opts: { fetchText?: (url: string) => Promise<string>; delayMs?: number } = {},
): Promise<ChainVenue[]> {
  const fetchText = opts.fetchText ?? defaultFetchText;
  const delayMs = opts.delayMs ?? 250;
  const sitemap = await fetchText(SITEMAP);
  const urls = [...sitemap.matchAll(/<loc>\s*(https:\/\/kirkenskorshaer\.dk\/genbrugsbutik\/[^<\s]+?)\s*<\/loc>/g)].map(
    (m) => m[1]!,
  );
  const out: ChainVenue[] = [];
  for (let i = 0; i < urls.length; i++) {
    try {
      const shop = parseKkShop(await fetchText(urls[i]!), urls[i]!);
      if (shop) out.push(shop);
    } catch {
      // Skip a single unreachable/odd page; keep going.
    }
    if (delayMs && i < urls.length - 1) await sleep(delayMs);
  }
  return out;
}
