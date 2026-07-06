/**
 * Kræftens Bekæmpelse Genbrug — the charity's ~18 second-hand shops, served by
 * a single authoritative JSON API (their store-finder widget). Address + hours
 * in one call; no coordinates, so addresses are forward-geocoded (DAWA). Feeds
 * ingestChainVenues like the other chains.
 */
import { classifyVenue } from '@loppefund/core';
import type { ChainVenue } from '../chain-venues.ts';
import { danishHoursToOsm, splitPostcodeCity, stableId } from './danish-hours.ts';

// take=100 pulls the full set in one page (there are ~18).
const API =
  'https://www.cancer.dk/da-DK/api/counsellingCenterApi/search/Search1--1b067f58-9e8e-4cb5-a8d2-4459974adeec?take=100';
const WEBSITE = 'https://www.cancer.dk/stoet-kraeftsagen/kraeftens-bekaempelse-genbrug/';
const UA = 'Loppefund/1.0 (+https://jacobtop-tcg.github.io/loppefund; Danish flea-market directory)';
const OPERATOR = 'Kræftens Bekæmpelse';
const OPERATOR_TOKEN = 'kraeftens';

interface Hit {
  title?: string;
  street?: string | null;
  city?: string;
  daysOne?: string;
  timeSlotOne?: string;
  daysTwo?: string;
  timeSlotTwo?: string;
}

export function parseKraeftensHits(hits: Hit[]): ChainVenue[] {
  const out: ChainVenue[] = [];
  for (const h of hits) {
    const street = (h.street ?? '').trim();
    // city looks like "3460 Birkerød" (sometimes with a "(bag …)" note).
    const { postcode, city } = splitPostcodeCity((h.city ?? '').replace(/\(.*?\)/g, '').trim());
    if (!street || !postcode) continue; // e.g. Horsens has street=null — skip, don't mis-place
    const hours = danishHoursToOsm(
      `${h.daysOne ?? ''} ${h.timeSlotOne ?? ''}\n${h.daysTwo ?? ''} ${h.timeSlotTwo ?? ''}`,
    );
    const title = `${OPERATOR} Genbrug, ${h.title ?? city}`;
    out.push({
      sourceType: 'kb',
      sourceId: stableId(`${street}|${postcode}`),
      operatorToken: OPERATOR_TOKEN,
      title,
      category: classifyVenue({ name: title, operator: OPERATOR }),
      street,
      postcode,
      city,
      openingHoursText: hours,
      contactWebsite: WEBSITE,
    });
  }
  return out;
}

async function defaultFetchJson(url: string): Promise<unknown> {
  const res = await globalThis.fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return res.json();
}

export async function fetchKraeftensBekaempelseVenues(
  opts: { fetchJson?: (url: string) => Promise<unknown> } = {},
): Promise<ChainVenue[]> {
  const fetchJson = opts.fetchJson ?? defaultFetchJson;
  const data = (await fetchJson(API)) as { hits?: Hit[] };
  return parseKraeftensHits(data.hits ?? []);
}
