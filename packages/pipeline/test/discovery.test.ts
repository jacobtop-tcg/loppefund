import { describe, expect, it } from 'vitest';
import type { RawEvent } from '@loppefund/core';
import type { FetchFn, FetchResult } from '../src/adapters/types.ts';
import { normalizeTitle } from '@loppefund/core';
import {
  analyzeHomepage,
  domainsFromRawEvent,
  isExcludedDomain,
  mineDomains,
  netNewCandidates,
  normalizeDomain,
  probeDomain,
  PROMOTE_THRESHOLD,
  REVIEW_THRESHOLD,
  scoreSignals,
  type ProbeSignals,
} from '../src/discovery.ts';

const OWN_DOMAINS = new Set([
  'markedskalenderen.dk',
  'loppemarkeder.nu',
  'findmarked.dk',
  'kultunaut.dk',
]);

function rawEvent(overrides: Partial<RawEvent>): RawEvent {
  return {
    sourceKey: 'markedskalenderen',
    sourceUrl: 'https://markedskalenderen.dk/marked/1',
    sourceEventId: '1',
    title: 'Loppemarked i Holte',
    ...overrides,
  };
}

describe('normalizeDomain', () => {
  it('strips scheme and www', () => {
    expect(normalizeDomain('https://www.olgod-kraemmermarked.dk/kalender?side=2')).toBe(
      'olgod-kraemmermarked.dk',
    );
  });

  it('strips trailing sentence punctuation', () => {
    expect(normalizeDomain('www.holte-loppemarked.dk.')).toBe('holte-loppemarked.dk');
    expect(normalizeDomain('https://olg.dk,')).toBe('olg.dk');
  });

  it('handles a bare www hostname without scheme', () => {
    expect(normalizeDomain('www.olg.dk')).toBe('olg.dk');
  });

  it('rejects hostnames without a dot', () => {
    expect(normalizeDomain('https://facebook')).toBeNull();
  });

  it('rejects garbage that does not parse as a URL', () => {
    expect(normalizeDomain('not a url at all')).toBeNull();
  });

  it('keeps internationalized domains as punycode', () => {
    expect(normalizeDomain('https://kræmmermarked.dk')).toBe('xn--krmmermarked-7cb.dk');
  });
});

describe('isExcludedDomain', () => {
  it('matches excluded suffixes including subdomains', () => {
    expect(isExcludedDomain('nemtilmeld.dk', OWN_DOMAINS)).toBe(true);
    expect(isExcludedDomain('loppemarked.nemtilmeld.dk', OWN_DOMAINS)).toBe(true);
    expect(isExcludedDomain('facebook.com', OWN_DOMAINS)).toBe(true);
  });

  it('matches own domains exactly', () => {
    expect(isExcludedDomain('markedskalenderen.dk', OWN_DOMAINS)).toBe(true);
    expect(isExcludedDomain('kultunaut.dk', OWN_DOMAINS)).toBe(true);
  });

  it('does not exclude ordinary organizer domains', () => {
    expect(isExcludedDomain('holte-loppemarked.dk', OWN_DOMAINS)).toBe(false);
    // suffix match only — no substring false positives
    expect(isExcludedDomain('notfacebook.com.dk', OWN_DOMAINS)).toBe(false);
  });
});

describe('domainsFromRawEvent', () => {
  it('dedupes contactWebsite and description mentions, contactWebsite label wins', () => {
    const raw = rawEvent({
      contactWebsite: 'https://www.olg.dk/marked',
      description: 'Se mere på www.olg.dk. Stadeleje betales via www.olg.dk/priser',
    });
    const domains = domainsFromRawEvent(raw);
    expect(domains.size).toBe(1);
    expect(domains.get('olg.dk')).toBe('contactWebsite');
  });

  it('mines URLs from description, priceText and scheduleText', () => {
    const raw = rawEvent({
      description: 'Program: https://holte-loppemarked.dk/program.',
      priceText: 'Stadeplads bookes på www.stadebooking.dk',
      scheduleText: 'Datoer på https://kalender.example.dk/2026',
    });
    const domains = domainsFromRawEvent(raw);
    expect(domains.get('holte-loppemarked.dk')).toBe('description');
    expect(domains.get('stadebooking.dk')).toBe('description');
    expect(domains.get('kalender.example.dk')).toBe('description');
  });

  it('does not apply exclusions — that is mineDomains\' job', () => {
    const raw = rawEvent({
      description: 'Følg os på https://www.facebook.com/events/123',
    });
    expect(domainsFromRawEvent(raw).get('facebook.com')).toBe('description');
  });
});

describe('mineDomains', () => {
  const raws: RawEvent[] = [
    rawEvent({
      title: 'Loppemarked i Holte',
      sourceKey: 'markedskalenderen',
      contactWebsite: 'https://www.holte-loppemarked.dk',
    }),
    rawEvent({
      title: 'Loppemarked i Holte',
      sourceKey: 'kultunaut',
      sourceEventId: '2',
      description: 'Læs mere på www.holte-loppemarked.dk.',
    }),
    rawEvent({
      title: 'Kræmmermarked Ølgod',
      sourceKey: 'markedskalenderen',
      sourceEventId: '3',
      contactWebsite: 'https://olg.dk',
      description: 'Se også www.holte-loppemarked.dk',
    }),
    rawEvent({
      title: 'Bagagerumsmarked',
      sourceKey: 'kultunaut',
      sourceEventId: '4',
      description:
        'Tilmelding på https://marked.nemtilmeld.dk/123 og opslag på www.facebook.com/x — ' +
        'arrangeret af https://markedskalenderen.dk',
    }),
  ];

  it('aggregates mentions, titles, sources and fields per domain', () => {
    const mined = mineDomains(raws, OWN_DOMAINS);
    const holte = mined.find((m) => m.domain === 'holte-loppemarked.dk');
    expect(holte).toBeDefined();
    expect(holte!.mentions).toBe(3);
    expect(holte!.distinctTitles).toBe(2);
    expect(holte!.sources.sort()).toEqual(['kultunaut', 'markedskalenderen']);
    expect(holte!.fields.sort()).toEqual(['contactWebsite', 'description']);
  });

  it('excludes stoplisted and own domains', () => {
    const domains = mineDomains(raws, OWN_DOMAINS).map((m) => m.domain);
    expect(domains).not.toContain('marked.nemtilmeld.dk');
    expect(domains).not.toContain('facebook.com');
    expect(domains).not.toContain('markedskalenderen.dk');
  });

  it('sorts by mentions desc, then domain asc', () => {
    const extra = [
      ...raws,
      rawEvent({ sourceEventId: '5', contactWebsite: 'https://aa-marked.dk' }),
      rawEvent({ sourceEventId: '6', contactWebsite: 'https://zz-marked.dk' }),
    ];
    const domains = mineDomains(extra, OWN_DOMAINS).map((m) => m.domain);
    expect(domains).toEqual(['holte-loppemarked.dk', 'aa-marked.dk', 'olg.dk', 'zz-marked.dk']);
  });

  it('leaves coveredTitles undefined when no canonical titles are given', () => {
    for (const m of mineDomains(raws, OWN_DOMAINS)) {
      expect(m.coveredTitles).toBeUndefined();
    }
  });

  it('counts how many of a candidate title set is already canonical (normalized)', () => {
    // Only "Loppemarked i Holte" is in the database, not "Kræmmermarked Ølgod".
    const canonical = new Set([normalizeTitle('Loppemarked i Holte')]);
    const mined = mineDomains(raws, OWN_DOMAINS, canonical);
    // holte's two titles: Holte (covered) + Ølgod (new) -> 1 covered.
    expect(mined.find((m) => m.domain === 'holte-loppemarked.dk')!.coveredTitles).toBe(1);
    // olg's only title is Ølgod -> 0 covered.
    expect(mined.find((m) => m.domain === 'olg.dk')!.coveredTitles).toBe(0);
  });
});

describe('netNewCandidates', () => {
  const raws: RawEvent[] = [
    rawEvent({ title: 'Loppemarked i Holte', contactWebsite: 'https://holte-loppemarked.dk' }),
    rawEvent({
      title: 'Kræmmermarked Ølgod',
      sourceEventId: '2',
      contactWebsite: 'https://olg.dk',
    }),
  ];

  it('drops domains whose every market is already covered', () => {
    const allCovered = new Set(
      ['Loppemarked i Holte', 'Kræmmermarked Ølgod'].map(normalizeTitle),
    );
    expect(netNewCandidates(mineDomains(raws, OWN_DOMAINS, allCovered))).toHaveLength(0);
  });

  it('keeps and ranks domains that reference a not-yet-canonical market', () => {
    const partial = new Set([normalizeTitle('Loppemarked i Holte')]);
    const netNew = netNewCandidates(mineDomains(raws, OWN_DOMAINS, partial));
    expect(netNew.map((m) => m.domain)).toEqual(['olg.dk']);
  });

  it('returns nothing when coverage was never computed', () => {
    expect(netNewCandidates(mineDomains(raws, OWN_DOMAINS))).toHaveLength(0);
  });
});

describe('analyzeHomepage + scoreSignals', () => {
  it('promotes a Danish page with JSON-LD Events and market keywords', () => {
    const html = `
      <html lang="da"><head>
        <script type="application/ld+json">{"@context":"https://schema.org","@type":"Event","name":"Loppemarked"}</script>
      </head><body>
        <h1>Loppemarked og kræmmermarked hver søndag</h1>
      </body></html>`;
    const analysis = analyzeHomepage(html);
    expect(analysis.jsonLdEvent).toBe(true);
    expect(analysis.keywordHits).toEqual(['loppemarked', 'kræmmermarked']);
    expect(analysis.danishMarkers).toBe(true);
    const score = scoreSignals({ ...analysis, httpStatus: 200 });
    expect(score).toBeGreaterThanOrEqual(PROMOTE_THRESHOLD);
  });

  it('detects the escaped JSON-LD variant', () => {
    const html = '<script>self.push("{\\"@type\\":\\"Event\\",\\"name\\":\\"Marked\\"}")</script>';
    expect(analyzeHomepage(html).jsonLdEvent).toBe(true);
  });

  it('scores an RSS-only Danish page at the review threshold', () => {
    const html = `
      <html><head>
        <link rel="alternate" type="application/rss+xml" href="/feed">
      </head><body>Nyheder fra Ølgod og omegn</body></html>`;
    const analysis = analyzeHomepage(html);
    expect(analysis.rssLink).toBe(true);
    expect(analysis.danishMarkers).toBe(true);
    expect(analysis.jsonLdEvent).toBe(false);
    expect(analysis.keywordHits).toEqual([]);
    expect(scoreSignals({ ...analysis, httpStatus: 200 })).toBe(REVIEW_THRESHOLD);
  });

  it('detects iCal and WordPress markers', () => {
    const html = '<a href="/kalender.ics">Kalender</a><img src="/wp-content/uploads/x.jpg">';
    const analysis = analyzeHomepage(html);
    expect(analysis.icalLink).toBe(true);
    expect(analysis.wordpress).toBe(true);
  });

  it('caps keyword hits at +3 and scores 0 on non-200', () => {
    const html =
      '<html lang="da">loppemarked kræmmermarked bagagerumsmarked antikmarked stadeplads</html>';
    const analysis = analyzeHomepage(html);
    expect(analysis.keywordHits.length).toBeGreaterThan(3);
    // 3 (keyword cap) + 1 (danish) = 4
    expect(scoreSignals({ ...analysis, httpStatus: 200 })).toBe(4);
    expect(scoreSignals({ ...analysis, httpStatus: 404 })).toBe(0);
    expect(scoreSignals({ ...analysis, httpStatus: 0 })).toBe(0);
  });
});

describe('probeDomain', () => {
  function stubFetch(responses: Record<string, Omit<FetchResult, 'url'>>): {
    fetch: FetchFn;
    calls: string[];
  } {
    const calls: string[] = [];
    const fetch: FetchFn = async (url) => {
      calls.push(url);
      const res = responses[url] ?? { status: 404, body: '' };
      return { url, ...res };
    };
    return { fetch, calls };
  }

  const WP_HOME = `
    <html lang="da"><head><link rel="https://api.w.org/" href="https://olg.dk/wp-json/"></head>
    <body><img src="/wp-content/themes/olgod/logo.png"> Kræmmermarked med stadepladser</body></html>`;

  it('probes a WordPress site with exactly one extra tribe fetch', async () => {
    const { fetch, calls } = stubFetch({
      'https://olg.dk/': { status: 200, body: WP_HOME },
      'https://olg.dk/wp-json/tribe/events/v1/events?per_page=1': {
        status: 200,
        body: JSON.stringify({ events: [{ id: 1 }] }),
      },
    });
    const { signals, score } = await probeDomain('olg.dk', fetch);
    expect(calls).toEqual([
      'https://olg.dk/',
      'https://olg.dk/wp-json/tribe/events/v1/events?per_page=1',
    ]);
    expect(signals.wordpress).toBe(true);
    expect(signals.tribeApi).toBe(true);
    // tribe 4 + keywords 2 + danish 1 + wordpress 1
    expect(score).toBe(8);
    expect(score).toBeGreaterThanOrEqual(PROMOTE_THRESHOLD);
  });

  it('does not set tribeApi when the endpoint returns non-JSON', async () => {
    const { fetch } = stubFetch({
      'https://olg.dk/': { status: 200, body: WP_HOME },
      'https://olg.dk/wp-json/tribe/events/v1/events?per_page=1': {
        status: 200,
        body: '<html>404 not found</html>',
      },
    });
    const { signals } = await probeDomain('olg.dk', fetch);
    expect(signals.tribeApi).toBe(false);
  });

  it('does not fetch the tribe endpoint for non-WordPress pages', async () => {
    const { fetch, calls } = stubFetch({
      'https://holte-loppemarked.dk/': {
        status: 200,
        body: '<html lang="da">Loppemarked i Holte</html>',
      },
    });
    const { signals, score } = await probeDomain('holte-loppemarked.dk', fetch);
    expect(calls).toEqual(['https://holte-loppemarked.dk/']);
    expect(signals.wordpress).toBe(false);
    expect(signals.tribeApi).toBe(false);
    // keyword 1 + danish 1
    expect(score).toBe(2);
  });

  it('falls back to http when https fails at the network level', async () => {
    const { fetch, calls } = stubFetch({
      'https://gammelt-marked.dk/': { status: 0, body: '' },
      'http://gammelt-marked.dk/': {
        status: 200,
        body: '<html lang="da">Kræmmermarked</html>',
      },
    });
    const { signals } = await probeDomain('gammelt-marked.dk', fetch);
    expect(calls).toEqual(['https://gammelt-marked.dk/', 'http://gammelt-marked.dk/']);
    expect(signals.httpStatus).toBe(200);
    expect(signals.keywordHits).toEqual(['kræmmermarked']);
  });

  it('scores 0 with empty signals when both attempts fail', async () => {
    const { fetch, calls } = stubFetch({
      'https://dead-domain.dk/': { status: 0, body: '' },
      'http://dead-domain.dk/': { status: 0, body: '' },
    });
    const { signals, score } = await probeDomain('dead-domain.dk', fetch);
    expect(calls).toHaveLength(2);
    expect(score).toBe(0);
    expect(signals).toEqual({
      httpStatus: 0,
      jsonLdEvent: false,
      icalLink: false,
      rssLink: false,
      tribeApi: false,
      wordpress: false,
      keywordHits: [],
      danishMarkers: false,
    } satisfies ProbeSignals);
  });

  it('does not retry via http on a plain HTTP error status', async () => {
    const { fetch, calls } = stubFetch({
      'https://borte.dk/': { status: 404, body: 'not found' },
    });
    const { signals, score } = await probeDomain('borte.dk', fetch);
    expect(calls).toEqual(['https://borte.dk/']);
    expect(signals.httpStatus).toBe(404);
    expect(score).toBe(0);
  });
});
