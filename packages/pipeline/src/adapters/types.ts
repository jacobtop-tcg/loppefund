import type { RawEvent } from '@loppefund/core';

export interface FetchResult {
  url: string;
  status: number;
  body: string;
}

export type FetchFn = (url: string) => Promise<FetchResult>;

/**
 * A source adapter is an independent, replaceable module.
 * discover() finds event page URLs; extract() turns one page into a RawEvent.
 * Adapters never write to the database.
 */
export interface SourceAdapter {
  key: string;
  name: string;
  baseUrl: string;
  /** 0..1 — how much we trust this source's data a priori. */
  trust: number;
  discover(fetch: FetchFn): Promise<string[]>;
  extract(url: string, html: string): RawEvent | null;
  /**
   * API-shaped sources implement this instead of discover/extract:
   * fetch everything in bulk and return raw events directly.
   */
  fetchRawEvents?(fetch: FetchFn): Promise<RawEvent[]>;
}
