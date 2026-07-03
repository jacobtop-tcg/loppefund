import { describe, expect, it } from 'vitest';
import { writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { facebookFeed, feedUrls, itemToRaw } from '../src/adapters/facebook-feed.ts';
import type { FetchResult } from '../src/adapters/types.ts';

const REF = '2026-07-02';

describe('facebook-feed adapter', () => {
  it('maps an Apify-shaped post to a low-trust draft event', () => {
    const raw = itemToRaw(
      {
        postId: '1086151306315308',
        postText:
          'LOPPEMARKED PÅ HAVNEN ⚓\nSøndag d. 12/7 kl. 10-16 på Havnevej 3, 5700 Svendborg.\nBoder med alt fra retro til babytøj. Gratis entré!',
        postUrl: 'https://www.facebook.com/groups/lopper.fyn/posts/1086151306315308/',
      },
      REF,
    );
    expect(raw).not.toBeNull();
    expect(raw!.sourceKey).toBe('facebook-feed');
    expect(raw!.sourceEventId).toBe('fb-1086151306315308');
    expect(raw!.sourceUrl).toContain('facebook.com/groups');
    expect(raw!.occurrences).toEqual([
      { date: '2026-07-12', startTime: '10:00', endTime: '16:00' },
    ]);
    expect(raw!.street).toBe('Havnevej 3');
    expect(raw!.postcode).toBe('5700');
    expect(raw!.city).toBe('Svendborg');
  });

  it('hashes an id for items without one and skips date-less chatter', () => {
    expect(
      itemToRaw({ text: 'Kæmpe marked lørdag 18/7 kl. 9-15 i Vejle' }, REF)!.sourceEventId,
    ).toMatch(/^fb-[0-9a-f]{16}$/);
    expect(itemToRaw({ text: 'Hvem skal med på loppemarked i weekenden? 😍' }, REF)).toBeNull();
  });

  it('reads feed URLs from the environment', () => {
    expect(feedUrls({} as NodeJS.ProcessEnv)).toEqual([]);
    expect(
      feedUrls({ LOPPEFUND_FB_FEED_URLS: 'https://a/items?token=x, https://b/items' } as NodeJS.ProcessEnv),
    ).toEqual(['https://a/items?token=x', 'https://b/items']);
  });

  it('derives last-run dataset URLs from APIFY_TOKEN', () => {
    const urls = feedUrls({ APIFY_TOKEN: 'tok123' } as NodeJS.ProcessEnv);
    expect(urls).toHaveLength(2);
    expect(urls[0]).toBe(
      'https://api.apify.com/v2/acts/apify~facebook-events-scraper/runs/last/dataset/items?token=tok123&status=SUCCEEDED&clean=true',
    );
    expect(
      feedUrls({ APIFY_TOKEN: 't', APIFY_ACTORS: 'me~custom-actor' } as NodeJS.ProcessEnv),
    ).toEqual([
      'https://api.apify.com/v2/acts/me~custom-actor/runs/last/dataset/items?token=t&status=SUCCEEDED&clean=true',
    ]);
  });

  describe('event-shaped items (Facebook events actor)', () => {
    it('maps machine dates, coordinates and address directly', () => {
      const raw = itemToRaw(
        {
          id: '987',
          name: 'Stort loppemarked på havnen',
          description: 'Boder, kaffe og loppefund til alle.',
          startDate: '2026-07-12T10:00:00+02:00',
          endDate: '2026-07-12T16:00:00+02:00',
          eventUrl: 'https://www.facebook.com/events/987',
          location: {
            name: 'Havnepladsen',
            address: 'Havnevej 3, 5700 Svendborg',
            latitude: 55.059,
            longitude: 10.61,
          },
        },
        REF,
      );
      expect(raw).not.toBeNull();
      expect(raw!.sourceEventId).toBe('fbevent-987');
      expect(raw!.occurrences).toEqual([
        { date: '2026-07-12', startTime: '10:00', endTime: '16:00' },
      ]);
      expect(raw!.venueName).toBe('Havnepladsen');
      expect(raw!.street).toBe('Havnevej 3');
      expect(raw!.postcode).toBe('5700');
      expect(raw!.lat).toBeCloseTo(55.059, 3);
    });

    it('converts unix timestamps to Danish wall-clock time', () => {
      const ts = Date.parse('2026-07-12T08:00:00Z') / 1000; // 10:00 dansk sommertid
      const raw = itemToRaw(
        { id: '1', name: 'Kræmmermarked i parken', startTimestamp: ts },
        REF,
      );
      expect(raw!.occurrences![0]).toEqual({
        date: '2026-07-12',
        startTime: '10:00',
        endTime: null,
      });
    });

    it('spans multi-day events with end time only on the last day', () => {
      const raw = itemToRaw(
        {
          id: '2',
          name: 'Weekend-loppemarked',
          startDate: '2026-07-11T10:00:00+02:00',
          endDate: '2026-07-12T15:00:00+02:00',
        },
        REF,
      );
      expect(raw!.occurrences).toEqual([
        { date: '2026-07-11', startTime: '10:00', endTime: null },
        { date: '2026-07-12', startTime: null, endTime: '15:00' },
      ]);
    });

    it('rejects non-market events and past-only events, honors cancellation', () => {
      expect(
        itemToRaw({ id: '3', name: 'Sommerkoncert i parken', startDate: '2026-07-12T20:00:00+02:00' }, REF),
      ).toBeNull();
      expect(
        itemToRaw({ id: '4', name: 'Loppemarked', startDate: '2026-06-01T10:00:00+02:00' }, REF),
      ).toBeNull();
      expect(
        itemToRaw(
          { id: '5', name: 'Loppemarked på torvet', startDate: '2026-07-12T10:00:00+02:00', isCanceled: true },
          REF,
        )!.cancelled,
      ).toBe(true);
    });
  });

  it('fetches and parses configured feeds', async () => {
    process.env.LOPPEFUND_FB_FEED_URLS = 'https://api.example.com/v2/datasets/d1/items';
    try {
      const stub = async (url: string): Promise<FetchResult> => ({
        url,
        status: 200,
        body: JSON.stringify([
          {
            postText: 'Bagagerumsmarked lørdag d. 18. juli kl. 10-14, Torvet, 8600 Silkeborg',
            postUrl: 'https://www.facebook.com/groups/x/posts/1/',
          },
          { postText: 'Tak for sidst! Dejlig dag 🌞' },
        ]),
      });
      const raws = await facebookFeed.fetchRawEvents!(stub);
      expect(raws).toHaveLength(1);
      expect(raws[0]!.category).toBe('bagagerumsmarked');
      expect(raws[0]!.occurrences?.[0]?.date).toBe('2026-07-18');
    } finally {
      delete process.env.LOPPEFUND_FB_FEED_URLS;
    }
  });

  it('keeps time null for a date-only structured event (no fabricated/DST-shifted hour)', () => {
    const raw = itemToRaw(
      { name: 'Marked i VBC Houlkær', startDate: '2026-11-14', location: { address: 'Viborg' } },
      '2026-07-03',
    );
    expect(raw).not.toBeNull();
    expect(raw!.occurrences![0]!.date).toBe('2026-11-14');
    expect(raw!.occurrences![0]!.startTime).toBeNull();
    expect(raw!.occurrences![0]!.endTime).toBeNull();
  });

  it('reads a local committed feed file without any HTTP fetch', async () => {
    const tmp = join(tmpdir(), `fb-feed-local-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
    await writeFile(
      tmp,
      JSON.stringify([
        {
          name: 'Loppemarked i Skårup',
          startDate: '2026-09-06T10:00:00+02:00',
          location: { address: 'Skårup By, 5881 Skårup' },
        },
      ]),
    );
    process.env.LOPPEFUND_FB_FEED_URLS = tmp;
    try {
      // A local path must be read from disk — fetch must never be called for it.
      const stub = async (): Promise<FetchResult> => {
        throw new Error('fetch must not be called for a local feed path');
      };
      const raws = await facebookFeed.fetchRawEvents!(stub);
      expect(raws).toHaveLength(1);
      expect(raws[0]!.occurrences?.[0]?.date).toBe('2026-09-06');
    } finally {
      delete process.env.LOPPEFUND_FB_FEED_URLS;
      await rm(tmp, { force: true });
    }
  });
});
