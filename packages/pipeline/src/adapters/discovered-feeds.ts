/**
 * Auto-ingest from AUTOMATICALLY DISCOVERED sources that expose a machine-
 * readable event feed — the only kind of new source that can be ingested with
 * ZERO human involvement without risking wrong data.
 *
 * The discovery engine (discovery.ts) mines domains out of markets we already
 * have, probes them, and records the structured signals it finds. This adapter
 * takes the domains whose probe found a working **Tribe Events REST API**
 * (WordPress' The Events Calendar) — pure, typed JSON, the same shape the
 * loppemarkeder.nu adapter already parses — and pulls their market events.
 *
 * Three safety rails, because these domains were never vetted by a human:
 *  1. STRUCTURED ONLY. Tribe's API returns typed fields (title, start_date,
 *     venue/address); dates and places come from the source's own machine data,
 *     never from guessing at HTML. Unstructured sites are NEVER auto-ingested —
 *     that would violate "incorrect is worse than missing".
 *  2. STRICT market gate per event. A discovered calendar carries all kinds of
 *     events; only titles/descriptions with an unambiguous market word pass.
 *  3. LOW TRUST. Registered at trust 0.3, so a single uncorroborated discovered
 *     event stays "ubekræftet" and can never inject a date into a confirmed
 *     market — the existing trust gates do the rest.
 *
 * Domains we already have a hand-written adapter for are excluded by the caller
 * (cli.ts) before this runs, so this never shadows loppemarkeder.nu itself.
 */
import type { RawEvent } from '@loppefund/core';
import type { FetchFn, SourceAdapter } from './types.ts';
import { tribeEventToRaw, type TribeEvent } from './loppemarkeder-nu.ts';

export const DISCOVERED_FEEDS_KEY = 'discovered-feeds';

const PER_PAGE = 50;
const MAX_PAGES = 20;
const MAX_DOMAINS = 30;

// A DELIBERATELY STRICT gate (mirrors the visitdenmark general-feed gate): on a
// site we know nothing about, a bare "antik"/"vintage" would drag in a museum
// talk or a clothing shop. Insist on an unambiguous market word — Danish
// "marked" only ever means market.
const MARKET_WORD = /loppe|marked|kr(æ|ae)mmer|bagagerum|torvedag|stadeplads|genbrugssalg/i;

function isMarket(e: TribeEvent): boolean {
  return MARKET_WORD.test(`${e.title} ${e.description ?? ''}`);
}

/** Fetch one domain's Tribe Events API, market-gated, as low-trust raw events. */
async function fetchTribeDomain(domain: string, fetch: FetchFn): Promise<RawEvent[]> {
  const out: RawEvent[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `https://${domain}/wp-json/tribe/events/v1/events?per_page=${PER_PAGE}&page=${page}`;
    let res;
    try {
      res = await fetch(url);
    } catch {
      break; // network/robots failure on this domain — skip it, don't guess
    }
    if (res.status !== 200) break;
    let data: { events?: TribeEvent[]; total_pages?: number };
    try {
      data = JSON.parse(res.body);
    } catch {
      break; // 200 but not JSON (theme served HTML) — not a real feed
    }
    const events = data.events ?? [];
    for (const e of events) {
      if (!e.title || !e.start_date || !isMarket(e)) continue;
      const raw = tribeEventToRaw(e, DISCOVERED_FEEDS_KEY);
      // Namespace the id by domain: two discovered feeds can both have event #5.
      out.push({ ...raw, sourceEventId: `${domain}:${e.id}`, sourceUrl: e.url || `https://${domain}/` });
    }
    if (events.length < PER_PAGE || page >= (data.total_pages ?? 1)) break;
  }
  return out;
}

/**
 * Build the auto-discovery ingest adapter for a set of domains that discovery
 * found to expose a Tribe feed. Returns null when there are none, so the caller
 * skips it cleanly (the common case today — Danish market sites rarely expose
 * structured feeds, so this activates only as the web adopts them).
 */
export function makeDiscoveredFeedsAdapter(domains: string[]): SourceAdapter | null {
  const targets = [...new Set(domains)].slice(0, MAX_DOMAINS);
  if (targets.length === 0) return null;
  return {
    key: DISCOVERED_FEEDS_KEY,
    name: 'Automatisk fundne feeds',
    baseUrl: 'https://loppefund.example', // synthetic: this source spans many domains
    trust: 0.3, // below tips (0.35): the least-vetted class — always "ubekræftet" alone
    async discover(): Promise<string[]> {
      return [];
    },
    extract(): RawEvent | null {
      return null;
    },
    async fetchRawEvents(fetch: FetchFn): Promise<RawEvent[]> {
      const all: RawEvent[] = [];
      for (const domain of targets) {
        all.push(...(await fetchTribeDomain(domain, fetch)));
      }
      return all;
    },
  };
}
