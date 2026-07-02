/**
 * Adapter for findmarked.dk — Next.js site with complete schema.org Event
 * data (including geo coordinates) embedded in the React flight payload.
 * robots.txt: Allow / with Crawl-delay 1; /api/ is disallowed and unused here.
 * Discovery via sitemap.xml (~590 market pages).
 */
import { normalizeCategory, type Occurrence, type RawEvent } from '@loppefund/core';
import type { FetchFn, SourceAdapter } from './types.ts';

const BASE = 'https://findmarked.dk';

interface SchemaEvent {
  '@type': string;
  name?: string;
  startDate?: string;
  endDate?: string;
  description?: string;
  eventStatus?: string;
  location?: {
    name?: string;
    address?: {
      streetAddress?: string;
      addressLocality?: string;
      postalCode?: string;
      addressRegion?: string;
    };
    geo?: { latitude?: number; longitude?: number };
  };
}

/**
 * Reassemble the client-side flight payload: every
 * `self.__next_f.push([1,"..."])` chunk holds an escaped string; chunks can
 * split a JSON object mid-way, so join them all before searching.
 */
export function joinFlightPayload(html: string): string {
  let joined = '';
  for (const m of html.matchAll(/self\.__next_f\.push\((\[1,"[\s\S]*?"\])\)<\/script>/g)) {
    try {
      const arr = JSON.parse(m[1]!) as [number, string];
      joined += arr[1];
    } catch {
      // skip malformed chunk
    }
  }
  return joined;
}

/** Extract the first schema.org Event object from unescaped payload text. */
export function extractSchemaEvent(payload: string): SchemaEvent | null {
  const marker = '{"@context":"https://schema.org","@type":"Event"';
  const start = payload.indexOf(marker);
  if (start === -1) return null;
  // Brace-count to find the end of the object, respecting strings.
  let depth = 0;
  let inString = false;
  for (let i = start; i < payload.length; i++) {
    const ch = payload[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(payload.slice(start, i + 1)) as SchemaEvent;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** Per-day occurrences from ISO start/end with Danish local offset. */
function toOccurrences(startDate?: string, endDate?: string): Occurrence[] {
  if (!startDate) return [];
  const startDay = startDate.slice(0, 10);
  const endDay = endDate?.slice(0, 10) || startDay;
  const startTime = startDate.length >= 16 ? startDate.slice(11, 16) : null;
  const endTime = endDate && endDate.length >= 16 ? endDate.slice(11, 16) : null;
  const out: Occurrence[] = [];
  let d = startDay;
  for (let i = 0; d <= endDay && i < 60; i++) {
    out.push({
      date: d,
      startTime: startTime === '00:00' && endTime === '00:00' ? null : startTime,
      endTime: startTime === '00:00' && endTime === '00:00' ? null : endTime,
    });
    const [y, m, day] = d.split('-').map(Number) as [number, number, number];
    d = new Date(Date.UTC(y, m - 1, day + 1)).toISOString().slice(0, 10);
  }
  return out;
}

export const findmarked: SourceAdapter = {
  key: 'findmarked',
  name: 'FindMarked',
  baseUrl: BASE,
  trust: 0.55,

  async discover(fetch: FetchFn): Promise<string[]> {
    const res = await fetch(`${BASE}/sitemap.xml`);
    if (res.status !== 200) return [];
    const urls: string[] = [];
    for (const m of res.body.matchAll(/<loc>(https:\/\/findmarked\.dk\/marked\/[^<]+)<\/loc>/g)) {
      urls.push(m[1]!);
    }
    return urls;
  },

  extract(url: string, html: string): RawEvent | null {
    const event = extractSchemaEvent(joinFlightPayload(html));
    if (!event?.name || !event.startDate) return null;
    const addr = event.location?.address;
    const geo = event.location?.geo;
    const cancelled = event.eventStatus?.includes('Cancelled') || undefined;
    return {
      sourceKey: 'findmarked',
      sourceUrl: url,
      sourceEventId: url.split('/').pop()!,
      title: event.name.trim(),
      description: event.description?.trim() || undefined,
      category: normalizeCategory(`${event.name} ${event.description ?? ''}`),
      venueName:
        event.location?.name && event.location.name !== event.name
          ? event.location.name
          : undefined,
      street: addr?.streetAddress,
      postcode: addr?.postalCode,
      city: addr?.addressLocality,
      lat: geo?.latitude,
      lng: geo?.longitude,
      occurrences: toOccurrences(event.startDate, event.endDate),
      cancelled,
    };
  },
};
