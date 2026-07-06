/**
 * Folkekirkens Nødhjælp genbrug — ~100 charity second-hand shops the org lists
 * on noedhjaelp.dk, with addresses AND opening hours. Same rationale and
 * machinery as the Kirkens Korshær adapter (see kirkenskorshaer.ts); only the
 * page markup differs. robots allows all; shops are enumerated from
 * page-sitemap.xml (/genbrug/genbrugsbutik-<by> URLs).
 *
 * Notably the org's OWN page places the Rudkøbing shop at Østergade 17-19 —
 * contradicting a third-party aggregator that said Ahlefeldtsgade — which is
 * exactly why we crawl the authoritative primary source, not directories.
 */
import { classifyVenue } from '@loppefund/core';
import type { ChainVenue } from '../chain-venues.ts';
import { toOsmHours } from './kirkenskorshaer.ts';

const SITEMAP = 'https://www.noedhjaelp.dk/page-sitemap.xml';
const UA = 'Loppefund/1.0 (+https://jacobtop-tcg.github.io/loppefund; Danish flea-market directory)';
const OPERATOR = 'Folkekirkens Nødhjælp';
const OPERATOR_TOKEN = 'noedhjaelp'; // folded "Nødhjælp"

const DA_DAYS = ['Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag', 'Søndag'];
const dayIndex = (name: string): number => DA_DAYS.findIndex((d) => d.toLowerCase() === name.trim().toLowerCase());

/** A stable numeric id from the shop slug (no numeric id in the URL). */
function idFromUrl(url: string): number {
  const slug = url.replace(/\/+$/, '').split('/').pop() ?? url;
  let h = 0;
  for (let i = 0; i < slug.length; i++) h = (h * 31 + slug.charCodeAt(i)) >>> 0;
  return h;
}

/** Parse one Folkekirkens Nødhjælp shop page, or null if no usable address. */
export function parseFnShop(html: string, url: string): ChainVenue | null {
  const city = html.match(/<h1[^>]*>\s*Genbrugsbutik\s+([^<]+?)\s*<\/h1>/i)?.[1]?.trim();

  // <strong>Adresse</strong><br><a ...>Street </a><br>0000 By</p>
  const addrBlock = html.match(/Adresse<\/strong>\s*<br>\s*(?:<a[^>]*>)?\s*([^<]+?)\s*(?:<\/a>)?\s*<br>\s*(\d{4})\s+([^<]+?)\s*<\/p>/i);
  if (!addrBlock) return null;
  const street = addrBlock[1]!.replace(/\s+/g, ' ').trim();
  const postcode = addrBlock[2]!;
  const cityFromAddr = addrBlock[3]!.replace(/\s+/g, ' ').trim();
  const title = `${OPERATOR}, ${city ?? cityFromAddr}`;

  // <strong>Åbningstider</strong><br>Mandag- Torsdag: 13.00 – 17.00<br>Fredag: …
  const hoursBlock = html.match(/Åbningstider\s*<\/strong>\s*<br>\s*(.*?)<\/p>/is);
  const byDay: Record<string, string> = {};
  if (hoursBlock) {
    for (const rawLine of hoursBlock[1]!.split(/<br\s*\/?>/i)) {
      const line = rawLine.replace(/&#8211;|&ndash;/g, '–').replace(/<[^>]+>/g, '').trim();
      const m = line.match(/^([A-Za-zæøåÆØÅ]+(?:\s*[-–]\s*[A-Za-zæøåÆØÅ]+)?)\s*:\s*(.+)$/);
      if (!m) continue;
      const label = m[1]!;
      // Times use dots ("13.00 – 17.00"); toOsmHours wants HH:MM.
      const time = m[2]!.replace(/(\d{1,2})\.(\d{2})/g, '$1:$2');
      const [a, b] = label.split(/\s*[-–]\s*/).map((s) => s.trim());
      const from = dayIndex(a!);
      const to = b ? dayIndex(b) : from;
      if (from < 0 || to < 0) continue;
      for (let i = from; i <= to; i++) byDay[DA_DAYS[i]!] = time;
    }
  }

  return {
    sourceType: 'fkn',
    sourceId: idFromUrl(url),
    operatorToken: OPERATOR_TOKEN,
    title,
    category: classifyVenue({ name: title, operator: OPERATOR }),
    street,
    postcode,
    city: city ?? cityFromAddr,
    openingHoursText: toOsmHours(byDay),
    contactWebsite: url,
  };
}

async function defaultFetchText(url: string): Promise<string> {
  // Per-request timeout so one hung page can't stall the whole sequential crawl.
  const res = await globalThis.fetch(url, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.text();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fetchFolkekirkensNoedhjaelpVenues(
  opts: { fetchText?: (url: string) => Promise<string>; delayMs?: number } = {},
): Promise<ChainVenue[]> {
  const fetchText = opts.fetchText ?? defaultFetchText;
  const delayMs = opts.delayMs ?? 250;
  const sitemap = await fetchText(SITEMAP);
  const urls = [
    ...sitemap.matchAll(/<loc>\s*(https:\/\/www\.noedhjaelp\.dk\/genbrug\/genbrugsbutik-[^<\s]+?)\s*<\/loc>/g),
  ].map((m) => m[1]!);
  const out: ChainVenue[] = [];
  for (let i = 0; i < urls.length; i++) {
    try {
      const shop = parseFnShop(await fetchText(urls[i]!), urls[i]!);
      if (shop) out.push(shop);
    } catch {
      // skip a single bad page
    }
    if (delayMs && i < urls.length - 1) await sleep(delayMs);
  }
  return out;
}
