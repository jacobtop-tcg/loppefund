/**
 * Fully automated ingestion of Facebook-group posts via a scraping vendor.
 *
 * We deliberately do NOT crawl Facebook ourselves — login-walled scraping
 * gets accounts banned and would put the whole "living database" at risk.
 * Instead, a vendor (e.g. an Apify actor scheduled vendor-side) harvests the
 * configured groups and exposes the posts as a JSON dataset; we pull that
 * feed, run every post through the announcement parser, and let the trust
 * model do its job: feed events enter at low trust and rise only through
 * corroboration or freshness.
 *
 * Configuration (no code changes needed to add feeds):
 *   LOPPEFUND_FB_FEED_URLS  comma-separated URLs returning a JSON array of
 *                           posts, e.g. an Apify dataset-items URL:
 *   https://api.apify.com/v2/datasets/<id>/items?token=<token>&clean=true
 *
 * Supported item shapes (vendor-agnostic best effort):
 *   { text | postText | message, url | postUrl | facebookUrl, id | postId }
 */
import { createHash } from 'node:crypto';
import type { RawEvent } from '@loppefund/core';
import type { FetchFn, SourceAdapter } from './types.ts';
import { parseTip } from '../tip-parser.ts';

interface FeedItem {
  id?: string | number;
  postId?: string | number;
  text?: string;
  postText?: string;
  message?: string;
  url?: string;
  postUrl?: string;
  facebookUrl?: string;
}

export function feedUrls(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.LOPPEFUND_FB_FEED_URLS ?? '')
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean);
}

export function itemToRaw(item: FeedItem, refDate: string): RawEvent | null {
  const text = item.text ?? item.postText ?? item.message ?? null;
  const url = item.url ?? item.postUrl ?? item.facebookUrl ?? null;
  const id =
    item.id ?? item.postId ?? (text ? createHash('sha256').update(text).digest('hex').slice(0, 16) : null);
  if (!id) return null;
  return parseTip({ id, url, text }, refDate, { key: 'facebook-feed', idPrefix: 'fb' });
}

export const facebookFeed: SourceAdapter = {
  key: 'facebook-feed',
  name: 'Facebook-grupper',
  baseUrl: 'https://www.facebook.com',
  // Announcements come straight from organizers, but automated parsing of
  // informal posts earns only cautious trust.
  trust: 0.4,

  async discover(): Promise<string[]> {
    return [];
  },

  extract(): RawEvent | null {
    return null;
  },

  async fetchRawEvents(fetch: FetchFn): Promise<RawEvent[]> {
    const urls = feedUrls();
    if (urls.length === 0) {
      console.log(
        '[facebook-feed] ingen feeds konfigureret — sæt LOPPEFUND_FB_FEED_URLS (se adapterens doc-kommentar)',
      );
      return [];
    }
    const refDate = new Date().toISOString().slice(0, 10);
    const out: RawEvent[] = [];
    for (const url of urls) {
      const res = await fetch(url);
      if (res.status !== 200) {
        console.log(`[facebook-feed] feed svarede ${res.status}: ${url.split('?')[0]}`);
        continue;
      }
      let items: FeedItem[];
      try {
        const parsed = JSON.parse(res.body) as FeedItem[] | { items?: FeedItem[] };
        items = Array.isArray(parsed) ? parsed : (parsed.items ?? []);
      } catch {
        console.log(`[facebook-feed] ugyldig JSON fra ${url.split('?')[0]}`);
        continue;
      }
      for (const item of items) {
        const raw = itemToRaw(item, refDate);
        if (raw) out.push(raw);
      }
    }
    return out;
  },
};
