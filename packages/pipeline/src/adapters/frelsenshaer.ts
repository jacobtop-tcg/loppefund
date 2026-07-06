/**
 * Frelsens Hær (Salvation Army) genbrug — ~11 shops. The chain's /genbrug/ page
 * embeds a Viamap map whose iframe ships an `allDatasets` blob of GeoJSON
 * Features (one per shop) with coordinates + a full address in `div2`. One fetch
 * of the iframe, no per-shop crawl, no geocoding. No opening hours in the blob.
 */
import { classifyVenue } from '@loppefund/core';
import type { ChainVenue } from '../chain-venues.ts';
import { stableId } from './danish-hours.ts';

const IFRAME = 'https://app.viamap.net/iframe/variant?id=8a83cfcf-63ec-4d83-5d7d-08d99c8550aa';
const WEBSITE = 'https://www.frelsenshaer.dk/genbrug/';
const UA = 'Loppefund/1.0 (+https://jacobtop-tcg.github.io/loppefund; Danish flea-market directory)';
const OPERATOR = 'Frelsens Hær';
const OPERATOR_TOKEN = 'frelsens haer';

interface Feature {
  geometry?: { coordinates?: number[] };
  properties?: { div1?: string; div2?: string };
}

/** Recursively find the first `data` array of GeoJSON Features in the blob. */
function findFeatures(x: unknown): Feature[] | null {
  if (Array.isArray(x)) {
    if (x.length && (x[0] as Feature)?.geometry && (x[0] as Feature)?.properties) return x as Feature[];
    for (const v of x) {
      const f = findFeatures(v);
      if (f) return f;
    }
  } else if (x && typeof x === 'object') {
    for (const v of Object.values(x)) {
      const f = findFeatures(v);
      if (f) return f;
    }
  }
  return null;
}

export function parseFrelsensHaer(html: string): ChainVenue[] {
  const m = html.match(/allDatasets\s*=\s*JSON\.parse\(JSON\.stringify\((\[[\s\S]*?\])\)\)/);
  if (!m) return [];
  let data: unknown;
  try {
    data = JSON.parse(m[1]!);
  } catch {
    return [];
  }
  const feats = findFeatures(data) ?? [];
  const out: ChainVenue[] = [];
  const seen = new Set<number>();
  for (const f of feats) {
    const c = f.geometry?.coordinates;
    if (!Array.isArray(c) || c.length < 2) continue;
    const lng = Number(c[0]);
    const lat = Number(c[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    // div2 like "Ravnevej 2, 6705 Esbjerg Ø"
    const am = (f.properties?.div2 ?? '').replace(/\s+/g, ' ').trim().match(/^(.*?),\s*(\d{4})\s+(.+)$/);
    if (!am) continue;
    const street = am[1]!.trim();
    const postcode = am[2]!;
    const city = am[3]!.trim();
    const id = stableId(`${street}|${postcode}`);
    if (seen.has(id)) continue;
    seen.add(id);
    const title = `${OPERATOR} Genbrug, ${(f.properties?.div1 ?? city).trim()}`;
    out.push({
      sourceType: 'fh',
      sourceId: id,
      operatorToken: OPERATOR_TOKEN,
      title,
      category: classifyVenue({ name: title, operator: OPERATOR }),
      street,
      postcode,
      city,
      openingHoursText: null,
      contactWebsite: WEBSITE,
      lat,
      lng,
    });
  }
  return out;
}

async function defaultFetchText(url: string): Promise<string> {
  const res = await globalThis.fetch(url, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.text();
}

export async function fetchFrelsensHaerVenues(
  opts: { fetchText?: (url: string) => Promise<string> } = {},
): Promise<ChainVenue[]> {
  const fetchText = opts.fetchText ?? defaultFetchText;
  return parseFrelsensHaer(await fetchText(IFRAME));
}
