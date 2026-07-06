/**
 * Mødrehjælpen genbrug — ~46 charity shops. Enumerated from a Yoast
 * shops-sitemap.xml; each /butikker/<slug>/ page carries a labelled "Adresse:" /
 * "Vejledende åbningstider:" HTML block (no coordinates, so addresses are
 * forward-geocoded). Same family as the Folkekirkens Nødhjælp adapter.
 */
import { classifyVenue } from '@loppefund/core';
import type { ChainVenue } from '../chain-venues.ts';
import { danishHoursToOsm, stableId } from './danish-hours.ts';

const SITEMAP = 'https://moedrehjaelpen.dk/shops-sitemap.xml';
const UA = 'Loppefund/1.0 (+https://jacobtop-tcg.github.io/loppefund; Danish flea-market directory)';
const OPERATOR = 'Mødrehjælpen';
const OPERATOR_TOKEN = 'moedrehjaelp';

/** Parse one /butikker/<slug>/ page, or null if no usable address. */
export function parseMoedreShop(html: string, url: string): ChainVenue | null {
  // <strong>Adresse:</strong><br> Istedgade 86,<br> 1650 København V</p>
  const am = html.match(
    /Adresse:\s*<\/strong>\s*<br\s*\/?>\s*([^<]+?),?\s*<br\s*\/?>\s*(\d{4})\s+([^<]+?)\s*<\/p>/i,
  );
  if (!am) return null;
  const street = am[1]!.replace(/\s+/g, ' ').replace(/,$/, '').trim();
  const postcode = am[2]!;
  const city = am[3]!.replace(/\s+/g, ' ').trim();

  // Hours block after "Vejledende åbningstider:" up to the paragraph end.
  const hb = html.match(/Vejledende åbningstider:.*?<\/strong>(.*?)<\/p>/is);
  const hours = danishHoursToOsm(hb?.[1] ?? null);

  const title = `${OPERATOR}, ${city}`;
  const slug = url.replace(/\/+$/, '').split('/').pop() ?? url;
  return {
    sourceType: 'mh',
    sourceId: stableId(`${street}|${postcode}|${slug}`),
    operatorToken: OPERATOR_TOKEN,
    title,
    category: classifyVenue({ name: title, operator: OPERATOR }),
    street,
    postcode,
    city,
    openingHoursText: hours,
    contactWebsite: url,
  };
}

async function defaultFetchText(url: string): Promise<string> {
  const res = await globalThis.fetch(url, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.text();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fetchMoedrehjaelpenVenues(
  opts: { fetchText?: (url: string) => Promise<string>; delayMs?: number } = {},
): Promise<ChainVenue[]> {
  const fetchText = opts.fetchText ?? defaultFetchText;
  const delayMs = opts.delayMs ?? 250;
  const sitemap = await fetchText(SITEMAP);
  const urls = [
    ...sitemap.matchAll(/<loc>\s*(https:\/\/moedrehjaelpen\.dk\/butikker\/[a-z0-9-]+\/)\s*<\/loc>/g),
  ].map((m) => m[1]!);
  const out: ChainVenue[] = [];
  for (let i = 0; i < urls.length; i++) {
    try {
      const shop = parseMoedreShop(await fetchText(urls[i]!), urls[i]!);
      if (shop) out.push(shop);
    } catch {
      // skip a single bad page
    }
    if (delayMs && i < urls.length - 1) await sleep(delayMs);
  }
  return out;
}
