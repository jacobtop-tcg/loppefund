import { describe, expect, it } from 'vitest';
import { openDb, upsertSourceCandidate, markCandidateProbed, listStructuredFeedDomains } from '@loppefund/db';
import { makeDiscoveredFeedsAdapter, DISCOVERED_FEEDS_KEY } from '../src/adapters/discovered-feeds.ts';
import type { FetchResult } from '../src/adapters/types.ts';

// A Tribe Events API page with one real market and one non-market event, so the
// strict market gate is exercised.
const tribePage = JSON.stringify({
  total_pages: 1,
  events: [
    {
      id: 11,
      title: 'Loppemarked i Testby',
      url: 'https://nytmarked.dk/event/loppemarked-testby/',
      start_date: '2026-08-01 10:00:00',
      end_date: '2026-08-01 15:00:00',
      all_day: false,
      venue: { address: 'Torvet 1, 4000 Roskilde, Danmark' },
    },
    {
      id: 12,
      title: 'Yoga i parken', // not a market — must be dropped
      url: 'https://nytmarked.dk/event/yoga/',
      start_date: '2026-08-02 09:00:00',
      end_date: '2026-08-02 10:00:00',
      all_day: false,
      venue: { address: 'Parken 2, 4000 Roskilde' },
    },
  ],
});

const mockFetch = (byUrl: Record<string, FetchResult>) => async (url: string): Promise<FetchResult> =>
  byUrl[url] ?? { url, status: 404, body: '' };

describe('makeDiscoveredFeedsAdapter', () => {
  it('returns null when there are no feed domains', () => {
    expect(makeDiscoveredFeedsAdapter([])).toBeNull();
  });

  it('pulls a domain Tribe feed, market-gated, at low trust with a namespaced id', async () => {
    const adapter = makeDiscoveredFeedsAdapter(['nytmarked.dk'])!;
    expect(adapter.trust).toBeLessThan(0.35); // below tips — always "ubekræftet" alone
    const p1 = 'https://nytmarked.dk/wp-json/tribe/events/v1/events?per_page=50&page=1';
    const raws = await adapter.fetchRawEvents!(
      mockFetch({ [p1]: { url: p1, status: 200, body: tribePage } }),
    );
    expect(raws).toHaveLength(1); // the yoga event is dropped by the market gate
    expect(raws[0]).toMatchObject({
      sourceKey: DISCOVERED_FEEDS_KEY,
      sourceEventId: 'nytmarked.dk:11',
      title: 'Loppemarked i Testby',
      postcode: '4000',
    });
    expect(raws[0]!.occurrences?.[0]).toMatchObject({ date: '2026-08-01', startTime: '10:00' });
  });

  it('skips a domain that serves HTML (not JSON) on the feed endpoint', async () => {
    const adapter = makeDiscoveredFeedsAdapter(['notreally.dk'])!;
    const p1 = 'https://notreally.dk/wp-json/tribe/events/v1/events?per_page=50&page=1';
    const raws = await adapter.fetchRawEvents!(
      mockFetch({ [p1]: { url: p1, status: 200, body: '<!doctype html><html>...' } }),
    );
    expect(raws).toEqual([]);
  });
});

describe('listStructuredFeedDomains', () => {
  it('returns only non-rejected domains whose probe found a Tribe feed', () => {
    const db = openDb(':memory:');
    const now = '2026-08-01T00:00:00.000Z';
    for (const domain of ['hastribe.dk', 'notribe.dk', 'rejected-tribe.dk']) {
      upsertSourceCandidate(db, {
        domain, mentions: 5, distinctTitles: 3, sources: ['x'], fields: ['contactWebsite'], seenAt: now,
      });
    }
    markCandidateProbed(db, 'hastribe.dk', { score: 8, signals: { tribeApi: true, wordpress: true } });
    markCandidateProbed(db, 'notribe.dk', { score: 4, signals: { tribeApi: false, jsonLdEvent: false } });
    markCandidateProbed(db, 'rejected-tribe.dk', { score: 8, signals: { tribeApi: true } });
    db.prepare(`UPDATE source_candidates SET status='rejected' WHERE domain='rejected-tribe.dk'`).run();

    expect(listStructuredFeedDomains(db)).toEqual(['hastribe.dk']);
  });
});
