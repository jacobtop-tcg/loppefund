/**
 * CVR — the definitive spine of permanent second-hand coverage.
 *
 * Erhvervsstyrelsen's official CVR distribution API is the free, authoritative,
 * continuously-synced register of every Danish business. Querying branchekode
 * 47.79.00 ("Detailhandel med brugte varer i forretninger") returns EVERY
 * registered genbrugsbutik / loppebutik / reolmarked / brugtvareforretning in
 * the country — the completeness OSM and the charity chains can never reach
 * alone. It also carries virksomhedsstatus, so a shop that closes is detected
 * automatically ("continuously detect closures").
 *
 * Access needs a FREE system-til-system credential (self-service registration
 * at datacvr.virk.dk, MitID-gated — which is why it can't be automated here).
 * Set CVR_USER / CVR_PASS as secrets; without them this adapter is a no-op, so
 * it never blocks a crawl. Address-only rows are forward-geocoded (DAWA) and
 * enriched with hours from OSM / the shop website where available — CVR gives
 * existence + address, never opening hours (we don't invent those).
 *
 * NOTE: the response parser targets the documented Vrvirksomhed schema and is
 * validated against live data the moment a credential is configured; it is
 * intentionally defensive (skips a row on any missing field) so it can only
 * ever ingest LESS, never wrong data — per the iron rule.
 */
import { classifyVenue } from '@loppefund/core';
import type { ChainVenue } from '../chain-venues.ts';
import { stableId } from './danish-hours.ts';

// 47.79.00 "Detailhandel med brugte varer i forretninger" — the DB07 six-digit
// form is 477900 (verified against real shops in CVR, e.g. Reolmarkedet Søndersø).
// This one code cleanly captures genbrug/loppe/reol/antik that sell used goods;
// broader retail/book codes would pull in NEW-goods shops (wrong data > missing).
const SECONDHAND_BRANCHEKODER = ['477900'];
const ES_URL = 'https://distribution.virk.dk/cvr-permanent/virksomhed/_search';
const UA = 'Loppefund/1.0 (+https://jacobtop-tcg.github.io/loppefund; Danish flea-market directory)';
const OPERATOR = 'CVR';
const OPERATOR_TOKEN = 'cvr';
// Statuses that mean the business is live and trading.
const ACTIVE = new Set(['AKTIV', 'NORMAL', 'Aktiv', 'aktiv']);

interface Adresse {
  vejnavn?: string;
  husnummerFra?: number | string;
  bogstavFra?: string;
  postnummer?: number | string;
  postdistrikt?: string;
  etage?: string;
}
interface Vrvirksomhed {
  cvrNummer?: number;
  virksomhedMetadata?: {
    nyesteNavn?: { navn?: string };
    nyesteBeliggenhedsadresse?: Adresse;
    nyesteHovedbranche?: { branchekode?: string; branchetekst?: string };
    sammensatStatus?: string;
  };
}

function formatStreet(a: Adresse): string | null {
  if (!a.vejnavn) return null;
  const nr = a.husnummerFra != null ? ` ${a.husnummerFra}${a.bogstavFra ?? ''}` : '';
  return `${a.vejnavn}${nr}`.trim();
}

/** Map one CVR company record to a venue, or null if not a usable active shop. */
export function parseCvrVirksomhed(v: Vrvirksomhed): ChainVenue | null {
  const m = v.virksomhedMetadata;
  if (!m) return null;
  if (m.sammensatStatus && !ACTIVE.has(m.sammensatStatus)) return null; // closed / bankrupt
  const title = m.nyesteNavn?.navn?.trim();
  const a = m.nyesteBeliggenhedsadresse;
  if (!title || !a) return null;
  const street = formatStreet(a);
  const postcode = a.postnummer != null ? String(a.postnummer) : null;
  const city = a.postdistrikt?.trim() ?? null;
  if (!street || !postcode || !city) return null; // address-less -> skip (missing ok)
  const idKey = v.cvrNummer != null ? `cvr:${v.cvrNummer}` : `${street}|${postcode}`;
  return {
    sourceType: 'cvr',
    sourceId: stableId(idKey),
    operatorToken: OPERATOR_TOKEN,
    title,
    category: classifyVenue({ name: title, operator: OPERATOR }),
    street,
    postcode,
    city,
    openingHoursText: null, // CVR has no hours — enriched from OSM/website elsewhere
    contactWebsite: null,
  };
}

async function defaultFetchPage(
  body: unknown,
  auth: string,
  scrollId?: string,
): Promise<{ hits: { _source?: { Vrvirksomhed?: Vrvirksomhed } }[]; scrollId?: string }> {
  const url = scrollId ? 'https://distribution.virk.dk/_search/scroll' : `${ES_URL}?scroll=2m`;
  const res = await globalThis.fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': UA,
      Authorization: `Basic ${auth}`,
    },
    body: JSON.stringify(scrollId ? { scroll: '2m', scroll_id: scrollId } : body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`CVR ES ${res.status}`);
  const json = (await res.json()) as {
    _scroll_id?: string;
    hits?: { hits?: { _source?: { Vrvirksomhed?: Vrvirksomhed } }[] };
  };
  return { hits: json.hits?.hits ?? [], scrollId: json._scroll_id };
}

/**
 * Pull every active second-hand shop from CVR. No-op (returns []) unless
 * CVR_USER/CVR_PASS are set. Uses the ES scroll API to page through thousands
 * of results. `fetchPage` is injectable for tests.
 */
export async function fetchCvrSecondhandVenues(
  opts: {
    fetchPage?: typeof defaultFetchPage;
    user?: string;
    pass?: string;
    maxPages?: number;
  } = {},
): Promise<ChainVenue[]> {
  const user = opts.user ?? process.env.CVR_USER;
  const pass = opts.pass ?? process.env.CVR_PASS;
  if (!user || !pass) return []; // not configured — safe no-op
  const fetchPage = opts.fetchPage ?? defaultFetchPage;
  const auth = Buffer.from(`${user}:${pass}`).toString('base64');
  const query = {
    size: 1000,
    query: {
      terms: { 'Vrvirksomhed.virksomhedMetadata.nyesteHovedbranche.branchekode': SECONDHAND_BRANCHEKODER },
    },
  };
  const out: ChainVenue[] = [];
  const seen = new Set<number>();
  let scrollId: string | undefined;
  const maxPages = opts.maxPages ?? 60;
  for (let page = 0; page < maxPages; page++) {
    const { hits, scrollId: next } = await fetchPage(query, auth, scrollId);
    if (hits.length === 0) break;
    for (const h of hits) {
      const v = h._source?.Vrvirksomhed;
      if (!v) continue;
      const venue = parseCvrVirksomhed(v);
      if (venue && !seen.has(venue.sourceId)) {
        seen.add(venue.sourceId);
        out.push(venue);
      }
    }
    scrollId = next;
    if (!scrollId) break;
  }
  return out;
}
