import { describe, expect, it } from 'vitest';
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
});
