/**
 * Bornholmermarked.dk — the definitive local board for Bornholm, an island the
 * national calendars barely cover. It's a community classifieds site, so its
 * "loppemarked" category mixes real market EVENTS (a dated kræmmermarked on
 * Skippertorvet in Nexø) with second-hand item ADS ("Flere billige ting, ring og
 * byd") and undated ad-hoc stalls ("open when the flag is out"). We keep only the
 * genuine events with a conservative two-part gate that honours "missing is
 * acceptable, incorrect is not":
 *   1. the title must read as a market (drops the item ads), and
 *   2. parseTip must find a concrete date (drops the undated/flag-based ones).
 * Each event page carries a schema.org Product with a clean name + a description
 * that holds the Danish date, time and address — exactly what parseTip extracts.
 * Community-posted, so cautious trust (0.45): unconfirmed until a second source
 * corroborates, same as a tip.
 */
import { parse } from 'node-html-parser';
import type { RawEvent } from '@loppefund/core';
import type { FetchFn, SourceAdapter } from './types.ts';
import { parseTip } from '../tip-parser.ts';
import { looksLikeMarket } from './kultunaut.ts';

const BASE = 'https://www.bornholmermarked.dk';
const LISTING = `${BASE}/kalender-og-events/loppemarked`;

// The posts rarely give a postcode, but the town is almost always in the title
// ("Kræmmermarked på Skippertorvet i Nexø", "Loppemarked i Østerlars"). Map the
// Bornholm towns to their postcode so the market geocodes to a real spot on the
// island instead of a vague regional label. Longest names first so "Østermarie"
// wins over a substring.
const BORNHOLM_TOWNS: ReadonlyArray<[string, string, string]> = [
  ['Aakirkeby', '3720', 'Aakirkeby'],
  ['Årsdale', '3740', 'Svaneke'],
  ['Østermarie', '3751', 'Østermarie'],
  ['Østerlars', '3760', 'Gudhjem'],
  ['Klemensker', '3782', 'Klemensker'],
  ['Snogebæk', '3730', 'Nexø'],
  ['Listed', '3740', 'Svaneke'],
  ['Svaneke', '3740', 'Svaneke'],
  ['Gudhjem', '3760', 'Gudhjem'],
  ['Allinge', '3770', 'Allinge'],
  ['Sandvig', '3770', 'Allinge'],
  ['Poulsker', '3730', 'Nexø'],
  ['Pedersker', '3720', 'Aakirkeby'],
  ['Nyker', '3700', 'Rønne'],
  ['Vestermarie', '3700', 'Rønne'],
  ['Rønne', '3700', 'Rønne'],
  ['Nexø', '3730', 'Nexø'],
  ['Hasle', '3790', 'Hasle'],
  ['Tejn', '3770', 'Allinge'],
  ['Melsted', '3760', 'Gudhjem'],
];

// parseTip's street matcher sometimes grabs a leading date fragment ("Lørdag den
// 4") from prose that has no real address. A "street" carrying a weekday, "den
// N", "kl.", a month or a 4-digit year is date noise, not an address — drop it so
// a wrong pin never beats an honest blank one.
const STREET_NOISE =
  /\b(?:mandag|tirsdag|onsdag|torsdag|fredag|lørdag|søndag)\b|\bden\s+\d|\bkl\.?\s*\d|\b\d{4}\b|\b(?:januar|februar|marts|april|maj|juni|juli|august|september|oktober|november|december)\b/i;

/** schema.org Product name + description from an event page. */
function productData(html: string): { name?: string; description?: string } {
  for (const m of html.matchAll(
    /<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g,
  )) {
    try {
      const j = JSON.parse(m[1]!.trim()) as { '@type'?: string; name?: string; description?: string };
      if (j['@type'] === 'Product') return { name: j.name, description: j.description };
    } catch {
      // malformed block — keep scanning
    }
  }
  return {};
}

/** One event page -> a market RawEvent, or null if it's an item ad / undated. */
export function extractMarket(url: string, html: string, refDate: string): RawEvent | null {
  const { name, description } = productData(html);
  const title = name?.trim();
  if (!title) return null;
  // Gate 1: the item ads ("Flere billige ting") have no market word in the title.
  if (!looksLikeMarket(title, description)) return null;
  // The name usually leads with the market's identity, then the description adds
  // the date/time/address — feed both to the tip parser (name first so it becomes
  // the title). Gate 2: parseTip returns null without a concrete date.
  const text = `${title}\n${description ?? ''}`.trim();
  const raw = parseTip({ id: url, url, text }, refDate, {
    key: 'bornholmermarked',
    idPrefix: 'bm',
  });
  if (!raw) return null;

  // Drop a street that is really a date fragment mis-parsed from prose.
  const street = raw.street && STREET_NOISE.test(raw.street) ? undefined : raw.street;

  // Resolve the town from the title/description. Every market here is on Bornholm
  // (postcodes 37xx), so the town in the title is authoritative — trust it over
  // parseTip's postcode, which can grab a year ("2026") as a Copenhagen postcode
  // from the prose. \b misfires on Danish letters (Ø/Æ/Å aren't \w), so bound with
  // Unicode letter lookarounds — otherwise "Nexø"/"Østerlars" never match.
  const hay = `${title} ${description ?? ''}`;
  const townHit = BORNHOLM_TOWNS.find(([town]) =>
    new RegExp(`(?<![\\p{L}])${town}(?![\\p{L}])`, 'iu').test(hay),
  );
  let { postcode, city } = raw;
  if (townHit) {
    [, postcode, city] = townHit;
  } else if (postcode && !/^37\d\d$/.test(postcode)) {
    // A non-Bornholm postcode on a Bornholm-only source is a mis-parse — drop it.
    postcode = undefined;
    city = undefined;
  }

  return { ...raw, street, postcode, city: city ?? 'Bornholm' };
}

export const bornholmermarked: SourceAdapter = {
  key: 'bornholmermarked',
  name: 'Bornholmermarked',
  baseUrl: BASE,
  trust: 0.45,

  async discover(fetch: FetchFn): Promise<string[]> {
    const res = await fetch(LISTING);
    if (res.status !== 200) return [];
    const urls = new Set<string>();
    const root = parse(res.body);
    for (const a of root.querySelectorAll('a[href*="/show/kalender-og-events/loppemarked/"]')) {
      const href = a.getAttribute('href');
      if (!href) continue;
      urls.add(href.startsWith('http') ? href : `${BASE}${href}`);
    }
    return [...urls];
  },

  extract(url: string, html: string): RawEvent | null {
    return extractMarket(url, html, new Date().toISOString().slice(0, 10));
  },
};
