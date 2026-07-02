/**
 * Adapter for sydfynskalenderen.dk — the regional calendar for South Funen.
 * Found via a real coverage gap: hyperlocal markets (private garage sales,
 * harbour flea markets) appear here but in no national calendar.
 *
 * Their REST/iCal endpoints redirect to the SPA, but the homepage embeds the
 * complete event dataset as HTML-entity-escaped JSON. We unescape and
 * brace-scan the records.
 *
 * Timezone caveat: startDate/endDate carry a "Z" suffix whose semantics are
 * ambiguous (local-stamped-as-UTC vs true UTC). Dates are identical under
 * both readings (no events near midnight), so we keep dates and leave times
 * null — never guess times.
 */
import { normalizeCategory, type Occurrence, type RawEvent } from '@loppefund/core';
import type { FetchFn, SourceAdapter } from './types.ts';
import { decodeEntities } from './loppemarkeder-nu.ts';
import { looksLikeMarket } from './kultunaut.ts';

const BASE = 'https://sydfynskalenderen.dk';

interface SydfynEvent {
  id: number;
  slug: string;
  name: string;
  description?: string;
  startDate?: string;
  endDate?: string;
  place?: { name?: string; address?: string; zipCode?: string; city?: string };
}

/** Brace-scan a JSON object starting at `start` in `text`. */
function scanObject(text: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/** Extract every event record from the (unescaped) homepage payload. */
export function extractSydfynEvents(html: string): SydfynEvent[] {
  const text = decodeEntities(html);
  const out: SydfynEvent[] = [];
  const seen = new Set<number>();
  for (const m of text.matchAll(/\{"id":\d+,"slug":"/g)) {
    const objText = scanObject(text, m.index!);
    if (!objText) continue;
    try {
      const obj = JSON.parse(objText) as SydfynEvent;
      if (obj.id && obj.slug && obj.name && !seen.has(obj.id)) {
        seen.add(obj.id);
        out.push(obj);
      }
    } catch {
      // partial/foreign object — skip
    }
  }
  return out;
}

/** Per-day occurrences from ISO dates; times deliberately null (TZ ambiguity). */
function toOccurrences(startDate?: string, endDate?: string): Occurrence[] {
  if (!startDate) return [];
  const startDay = startDate.slice(0, 10);
  const endDay = endDate?.slice(0, 10) || startDay;
  const out: Occurrence[] = [];
  let d = startDay;
  for (let i = 0; d <= endDay && i < 40; i++) {
    out.push({ date: d, startTime: null, endTime: null });
    const [y, mo, day] = d.split('-').map(Number) as [number, number, number];
    d = new Date(Date.UTC(y, mo - 1, day + 1)).toISOString().slice(0, 10);
  }
  return out;
}

export function sydfynEventToRaw(e: SydfynEvent): RawEvent | null {
  if (!looksLikeMarket(e.name, e.description)) return null;
  const occurrences = toOccurrences(e.startDate, e.endDate);
  if (occurrences.length === 0) return null;
  return {
    sourceKey: 'sydfynskalenderen',
    sourceUrl: `${BASE}/begivenhed/${e.slug}`,
    sourceEventId: String(e.id),
    title: e.name.trim(),
    description: e.description?.trim() || undefined,
    category: normalizeCategory(`${e.name} ${e.description ?? ''}`),
    venueName:
      e.place?.name && e.place.name !== e.name ? e.place.name : undefined,
    street: e.place?.address || undefined,
    postcode: e.place?.zipCode || undefined,
    city: e.place?.city || undefined,
    occurrences,
  };
}

export const sydfynskalenderen: SourceAdapter = {
  key: 'sydfynskalenderen',
  name: 'Sydfynskalenderen',
  baseUrl: BASE,
  trust: 0.55,

  async discover(): Promise<string[]> {
    return [];
  },

  extract(): RawEvent | null {
    return null;
  },

  async fetchRawEvents(fetch: FetchFn): Promise<RawEvent[]> {
    const res = await fetch(`${BASE}/`);
    if (res.status !== 200) return [];
    return extractSydfynEvents(res.body)
      .map(sydfynEventToRaw)
      .filter((r): r is RawEvent => r !== null);
  },
};
