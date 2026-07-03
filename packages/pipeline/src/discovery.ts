/**
 * Source discovery: find new crawlable market websites from the data we
 * already have, instead of guessing.
 *
 * The loop: mine → candidate → probe → promote → hand-written adapter.
 * 1. mine    — extract external domains mentioned in RawEvents (contact
 *              websites and URLs inside free-text fields), drop our own
 *              domains and a stoplist of social/ticketing/utility hosts.
 * 2. candidate — aggregate mentions per domain; domains referenced by many
 *              events/titles/sources are likely organizer or calendar sites.
 * 3. probe   — fetch the homepage once and look for machine-readable signals
 *              (JSON-LD Events, iCal/RSS feeds, WordPress + Tribe Events API,
 *              Danish market keywords) and score them.
 * 4. promote — score >= PROMOTE_THRESHOLD means "write an adapter for this";
 *              REVIEW_THRESHOLD..PROMOTE_THRESHOLD means "a human should look".
 * 5. hand-written adapter — a promoted domain gets a real SourceAdapter;
 *              discovery never auto-ingests, it only nominates.
 *
 * Everything here is pure except probeDomain, which takes a FetchFn so the
 * polite fetcher (rate limits, robots.txt) stays in charge of all network I/O.
 */
import { normalizeTitle } from '@loppefund/core';
import type { RawEvent } from '@loppefund/core';
import type { FetchFn } from './adapters/types.ts';

/**
 * Domains we never nominate, matched by suffix (so subdomains are covered):
 * social/auth-walled platforms, ticketing/signup services, and generic
 * utilities. None of these are crawlable primary sources.
 */
export const EXCLUDED_DOMAIN_SUFFIXES: readonly string[] = [
  // social / auth-walled
  'facebook.com',
  'fb.com',
  'fb.me',
  'messenger.com',
  'instagram.com',
  'linkedin.com',
  'tiktok.com',
  'x.com',
  'twitter.com',
  'youtube.com',
  'youtu.be',
  // ticketing / signup
  'billetto.dk',
  'billetto.com',
  'billetsalg.dk',
  'billetten.dk',
  'safeticket.dk',
  'place2book.com',
  'nemtilmeld.dk',
  'eventbrite.com',
  'eventbrite.dk',
  'ticketmaster.dk',
  // utilities
  'google.com',
  'goo.gl',
  'forms.gle',
  'bit.ly',
  'kortlink.dk',
  'mobilepay.dk',
];

/**
 * Danish market vocabulary, grouped by synonym: a homepage scores one
 * keyword hit per group no matter how many variants appear.
 */
export const MARKET_KEYWORDS: readonly (readonly string[])[] = [
  ['loppemarked'],
  ['kræmmermarked', 'kraemmermarked'],
  ['bagagerumsmarked'],
  ['genbrugsmarked'],
  ['antikmarked'],
  ['stadeplads', 'stadepladser'],
  ['stadeleje'],
  ['markedskalender'],
  ['kræmmere', 'kraemmere'],
];

/** Probe score at or above which a domain is worth a hand-written adapter. */
export const PROMOTE_THRESHOLD = 6;

/** Probe score at or above which a domain deserves a manual look. */
export const REVIEW_THRESHOLD = 3;

/**
 * Reduce a raw URL (or bare hostname like "www.olg.dk") to a normalized
 * registrable-looking domain: lowercase, no scheme, no www., no trailing
 * sentence punctuation. Returns null for anything that does not look like
 * a real dotted hostname.
 */
export function normalizeDomain(rawUrl: string): string | null {
  let url = rawUrl.trim().replace(/[.,;:!?)\]]+$/, '');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) url = `http://${url}`;
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return null;
  }
  const domain = hostname.toLowerCase().replace(/^www\./, '');
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain) ? domain : null;
}

/**
 * True when the domain is one of our own sources (exact match) or falls
 * under an excluded suffix (the suffix itself or any subdomain of it).
 */
export function isExcludedDomain(domain: string, ownDomains: Set<string>): boolean {
  if (ownDomains.has(domain)) return true;
  return EXCLUDED_DOMAIN_SUFFIXES.some(
    (s) => domain === s || domain.endsWith(`.${s}`),
  );
}

const URL_IN_TEXT = /(?:https?:\/\/|www\.)[^\s"'<>()\]]+/gi;

/**
 * All external domains one RawEvent references, mapped to where we saw them.
 * The structured contactWebsite field wins over free-text mentions; each
 * domain appears at most once per event. Exclusion is NOT applied here —
 * that is mineDomains' job, so callers can still inspect everything.
 */
export function domainsFromRawEvent(
  raw: RawEvent,
): Map<string, 'contactWebsite' | 'description'> {
  const domains = new Map<string, 'contactWebsite' | 'description'>();
  if (raw.contactWebsite) {
    const domain = normalizeDomain(raw.contactWebsite);
    if (domain) domains.set(domain, 'contactWebsite');
  }
  const text = [raw.description, raw.priceText, raw.scheduleText]
    .filter(Boolean)
    .join(' ');
  for (const match of text.matchAll(URL_IN_TEXT)) {
    const domain = normalizeDomain(match[0]);
    if (domain && !domains.has(domain)) domains.set(domain, 'description');
  }
  return domains;
}

/** One candidate domain with the evidence that makes it interesting. */
export interface DomainMention {
  domain: string;
  /** Number of raw events referencing the domain. */
  mentions: number;
  /** Distinct raw event titles — many titles suggests a calendar site. */
  distinctTitles: number;
  /**
   * How many of those distinct titles are ALREADY canonical events, set only
   * when mineDomains is given the canonical title set. Discovery mines domains
   * out of raw events we already crawled, so a domain is usually the operator's
   * own link for markets we already have — coveredTitles == distinctTitles means
   * "nothing new here". distinctTitles - coveredTitles is the net-new signal
   * that actually justifies writing an adapter. Undefined when not computed.
   */
  coveredTitles?: number;
  /** Distinct source keys the mentions came from. */
  sources: string[];
  /** Union of fields the domain was seen in. */
  fields: string[];
}

/**
 * Aggregate domain mentions across raw events into candidates, dropping our
 * own domains and the stoplist. Sorted by mentions desc, then domain asc.
 *
 * When `canonicalTitles` (a set of normalizeTitle()'d canonical event titles)
 * is given, each candidate also gets coveredTitles — how many of its titles we
 * already have — so callers can tell an operator's link for known markets apart
 * from a genuinely new source.
 */
export function mineDomains(
  raws: RawEvent[],
  ownDomains: Set<string>,
  canonicalTitles?: ReadonlySet<string>,
): DomainMention[] {
  const agg = new Map<
    string,
    { mentions: number; titles: Set<string>; sources: Set<string>; fields: Set<string> }
  >();
  for (const raw of raws) {
    for (const [domain, field] of domainsFromRawEvent(raw)) {
      if (isExcludedDomain(domain, ownDomains)) continue;
      let entry = agg.get(domain);
      if (!entry) {
        entry = { mentions: 0, titles: new Set(), sources: new Set(), fields: new Set() };
        agg.set(domain, entry);
      }
      entry.mentions += 1;
      entry.titles.add(raw.title);
      entry.sources.add(raw.sourceKey);
      entry.fields.add(field);
    }
  }
  return [...agg.entries()]
    .map(([domain, entry]) => ({
      domain,
      mentions: entry.mentions,
      distinctTitles: entry.titles.size,
      ...(canonicalTitles
        ? {
            coveredTitles: [...entry.titles].filter((t) =>
              canonicalTitles.has(normalizeTitle(t)),
            ).length,
          }
        : {}),
      sources: [...entry.sources],
      fields: [...entry.fields],
    }))
    .sort((a, b) => b.mentions - a.mentions || a.domain.localeCompare(b.domain));
}

/**
 * Candidates that reference at least one market whose title we can't match to
 * an existing event — the shortlist actually worth a hand-written adapter. A
 * domain whose every title is already canonical (its markets reach us via other
 * sources) drops out, however many times it is mentioned. Requires mineDomains
 * to have run with canonicalTitles. Ranked by net-new title count, then mentions.
 *
 * Matching is exact on normalizeTitle, so it errs toward INCLUSION: the same
 * market phrased differently across sources ("LoppeLinda på Enghave Plads" vs a
 * generic "Loppemarked") can look net-new when it is in fact covered. That is
 * the safe direction for a triage hint — a covered domain shown for a second
 * look wastes a glance; a genuinely new source dropped is lost coverage.
 */
export function netNewCandidates(mined: DomainMention[]): DomainMention[] {
  const netNew = (m: DomainMention): number =>
    m.coveredTitles === undefined ? 0 : m.distinctTitles - m.coveredTitles;
  return mined
    .filter((m) => netNew(m) >= 1)
    .sort(
      (a, b) =>
        netNew(b) - netNew(a) ||
        b.mentions - a.mentions ||
        a.domain.localeCompare(b.domain),
    );
}

/** Machine-readable signals found when probing a candidate's homepage. */
export interface ProbeSignals {
  httpStatus: number;
  /** schema.org Event in JSON-LD (plain or JS-string-escaped). */
  jsonLdEvent: boolean;
  /** Links to an .ics file or text/calendar feed. */
  icalLink: boolean;
  /** RSS or Atom feed link. */
  rssLink: boolean;
  /** The Events Calendar (Tribe) REST API responds — best case, pure JSON. */
  tribeApi: boolean;
  /** WordPress site — worth trying wp-json APIs. */
  wordpress: boolean;
  /** Which MARKET_KEYWORDS groups matched (group[0] as the name). */
  keywordHits: string[];
  /** Danish language markers (lang="da" or æ/ø/å). */
  danishMarkers: boolean;
}

const LD_JSON_SCRIPT =
  /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

/**
 * Inspect homepage HTML for crawlability signals. Pure — network-derived
 * fields (httpStatus, tribeApi confirmation) are filled in by probeDomain.
 */
export function analyzeHomepage(html: string): Omit<ProbeSignals, 'httpStatus'> {
  let jsonLdEvent = false;
  for (const match of html.matchAll(LD_JSON_SCRIPT)) {
    if (/"@type"\s*:\s*"Event"/.test(match[1] ?? '')) {
      jsonLdEvent = true;
      break;
    }
  }
  if (!jsonLdEvent) jsonLdEvent = /\\"@type\\"\s*:\s*\\"Event\\"/.test(html);

  const lower = html.toLowerCase();
  const keywordHits: string[] = [];
  for (const group of MARKET_KEYWORDS) {
    if (group.some((keyword) => lower.includes(keyword))) keywordHits.push(group[0]!);
  }

  return {
    jsonLdEvent,
    icalLink: /\.ics|text\/calendar/i.test(html),
    rssLink: /application\/(rss|atom)\+xml/i.test(html),
    tribeApi: false,
    wordpress: /wp-content|wp-json/.test(html),
    keywordHits,
    danishMarkers: /lang="da"|æ|ø|å/i.test(html),
  };
}

/**
 * Weigh signals into a single score. Structured data (JSON-LD, Tribe API,
 * iCal/RSS) dominates; keywords and Danish markers only tip the balance.
 */
export function scoreSignals(s: ProbeSignals): number {
  if (s.httpStatus !== 200) return 0;
  let score = 0;
  if (s.jsonLdEvent) score += 3;
  if (s.tribeApi) score += 4;
  if (s.icalLink) score += 2;
  if (s.rssLink) score += 2;
  score += Math.min(s.keywordHits.length, 3);
  if (s.danishMarkers) score += 1;
  if (s.wordpress) score += 1;
  return score;
}

/**
 * Probe one candidate domain: fetch its homepage (https, falling back to
 * http when the fetcher reports a network error or robots block), analyze
 * it, and — only for WordPress sites — try the Tribe Events REST API.
 * All network access goes through the injected FetchFn.
 */
export async function probeDomain(
  domain: string,
  fetch: FetchFn,
): Promise<{ signals: ProbeSignals; score: number }> {
  let res = await fetch(`https://${domain}/`);
  if (res.status === 0 || res.status === -1) {
    res = await fetch(`http://${domain}/`);
  }
  if (res.status !== 200) {
    const signals: ProbeSignals = {
      httpStatus: res.status,
      jsonLdEvent: false,
      icalLink: false,
      rssLink: false,
      tribeApi: false,
      wordpress: false,
      keywordHits: [],
      danishMarkers: false,
    };
    return { signals, score: 0 };
  }

  const analysis = analyzeHomepage(res.body);
  let tribeApi = false;
  if (analysis.wordpress) {
    const tribe = await fetch(
      `https://${domain}/wp-json/tribe/events/v1/events?per_page=1`,
    );
    if (tribe.status === 200) {
      try {
        const parsed: unknown = JSON.parse(tribe.body);
        tribeApi =
          typeof parsed === 'object' &&
          parsed !== null &&
          Array.isArray((parsed as { events?: unknown }).events);
      } catch {
        // 200 but not JSON — some themes serve HTML on unknown routes
      }
    }
  }

  const signals: ProbeSignals = { ...analysis, httpStatus: res.status, tribeApi };
  return { signals, score: scoreSignals(signals) };
}

/**
 * Render discovery candidates as an aligned text table for the CLI,
 * with a legend explaining statuses and the score thresholds.
 */
export function formatReport(
  rows: Array<{
    domain: string;
    mentions: number;
    distinct_titles: number;
    status: string;
    probe_score: number | null;
  }>,
): string {
  const header = ['domain', 'mentions', 'titles', 'status', 'score'];
  const cells = rows.map((row) => [
    row.domain,
    String(row.mentions),
    String(row.distinct_titles),
    row.status,
    row.probe_score === null ? '-' : String(row.probe_score),
  ]);
  const widths = header.map((h, col) =>
    Math.max(h.length, ...cells.map((row) => row[col]!.length)),
  );
  const numeric = [false, true, true, false, true];
  const renderRow = (row: string[]): string =>
    row
      .map((cell, col) =>
        numeric[col] ? cell.padStart(widths[col]!) : cell.padEnd(widths[col]!),
      )
      .join('  ')
      .trimEnd();
  const lines = [renderRow(header), ...cells.map(renderRow)];
  lines.push(
    `Legend: candidate = mined, not probed yet · probed = homepage analyzed · ` +
      `promoted = score >= ${PROMOTE_THRESHOLD} (write an adapter) · ` +
      `review = score >= ${REVIEW_THRESHOLD} (needs a human look) · ` +
      `rejected = excluded or not worth crawling. score '-' = never probed.`,
  );
  return lines.join('\n');
}
