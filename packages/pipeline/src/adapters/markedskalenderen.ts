/**
 * Adapter for markedskalenderen.dk — a Danish market calendar with
 * cleanly labelled event pages. robots.txt allows all crawling.
 */
import { parse } from 'node-html-parser';
import {
  extractPostcode,
  normalizeCategory,
  normalizeIndoorOutdoor,
  parseDanishDate,
  parseIsFree,
  type RawEvent,
} from '@loppefund/core';
import type { FetchFn, SourceAdapter } from './types.ts';

const BASE = 'https://markedskalenderen.dk';

/** Event-type categories only — shops and shelf-rental categories are excluded. */
const CATEGORIES = [
  'loppemarked',
  'kraemmermarked',
  'bagagerumsmarked',
  'antikmarked',
  'gadevejgardloppemarked',
  'private-loppemarkedergaragesalg',
  'spejderforeningsloppemarked',
  'byttemarked',
  'julemarked',
];

const MAX_PAGES_PER_CATEGORY = 30;

export const markedskalenderen: SourceAdapter = {
  key: 'markedskalenderen',
  name: 'Markedskalenderen',
  baseUrl: BASE,
  trust: 0.7,

  async discover(fetch: FetchFn): Promise<string[]> {
    const urls = new Set<string>();
    for (const category of CATEGORIES) {
      for (let page = 1; page <= MAX_PAGES_PER_CATEGORY; page++) {
        const listUrl = `${BASE}/marked/kategori/${category}${page > 1 ? `?page=${page}` : ''}`;
        const res = await fetch(listUrl);
        if (res.status !== 200) break;
        const before = urls.size;
        for (const m of res.body.matchAll(
          /href="(https:\/\/markedskalenderen\.dk\/marked\/show\/[a-z0-9-]+)"/g,
        )) {
          urls.add(m[1]!);
        }
        const hasNext = res.body.includes(`/marked/kategori/${category}?page=${page + 1}`);
        if (!hasNext || urls.size === before) break;
      }
    }
    return [...urls];
  },

  extract(url: string, html: string): RawEvent | null {
    const root = parse(html);
    const title = root.querySelector('h1')?.text.trim();
    if (!title) return null;

    // Labelled rows: <div class="row"><div><i>Label:</i></div><div>value</div></div>
    // Only rows with exactly two direct div children are label/value pairs —
    // Bootstrap nests rows, so descendant queries would grab wrapper rows.
    const fields = new Map<string, ReturnType<typeof parse>>();
    for (const row of root.querySelectorAll('div.row')) {
      const cells = row.childNodes.filter(
        (n) => 'rawTagName' in n && (n as { rawTagName: string }).rawTagName === 'div',
      ) as unknown as Array<ReturnType<typeof parse>>;
      if (cells.length !== 2) continue;
      const labelEl = cells[0]!.querySelector('i');
      // The label cell must contain nothing but the <i> label — wrapper rows
      // that merely contain a labelled row deeper down are skipped.
      if (!labelEl || cells[0]!.text.trim() !== labelEl.text.trim()) continue;
      const label = labelEl.text.replace(/:\s*$/, '').trim();
      if (label && !fields.has(label)) fields.set(label, cells[1]!);
    }
    const text = (label: string): string | undefined => {
      const v = fields.get(label)?.text.replace(/\s+/g, ' ').trim();
      return v || undefined;
    };

    // Perioder: <option>dd-mm-yyyy til dd-mm-yyyy</option> + trailing recurrence text
    const dateRanges: Array<{ start: string; end: string }> = [];
    let scheduleText: string | undefined;
    const perioder = fields.get('Perioder');
    if (perioder) {
      for (const opt of perioder.querySelectorAll('option')) {
        const m = opt.text.match(/(\S+)\s+til\s+(\S+)/);
        if (!m) continue;
        const start = parseDanishDate(m[1]!);
        const end = parseDanishDate(m[2]!);
        if (start && end && end >= start) dateRanges.push({ start, end });
      }
      // Whatever remains after removing the date ranges is recurrence text,
      // e.g. "Søndag i alle ulige uger".
      const leftover = perioder.text
        .replace(/\d{2}-\d{2}-\d{4}\s+til\s+\d{2}-\d{2}-\d{4}/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (leftover) scheduleText = leftover;
    }

    // Address: "Strandgade 95, 1401 København K"
    const addressText = text('Adresse');
    let street: string | undefined;
    let postcode: string | undefined;
    let city: string | undefined;
    if (addressText) {
      postcode = extractPostcode(addressText) ?? undefined;
      const parts = addressText.split(',').map((p) => p.trim());
      street = parts[0];
      const tail = parts.slice(1).join(', ');
      city = tail.replace(/^\d{4}\s*/, '').trim() || undefined;
    }

    // Description: the <p> after <h2>Beskrivelse</h2>
    let description: string | undefined;
    const h2 = root
      .querySelectorAll('h2')
      .find((h) => h.text.trim() === 'Beskrivelse');
    if (h2) {
      let sibling = h2.nextElementSibling;
      while (sibling && sibling.rawTagName !== 'p') sibling = sibling.nextElementSibling;
      description = sibling?.structuredText.trim() || undefined;
    }

    const website = fields.get('Hjemmeside')?.querySelector('a')?.getAttribute('href');
    const priceText = text('Entrébetaling');
    const slug = url.split('/').pop()!;
    const cancelled = /aflyst/i.test(title) || undefined;

    return {
      sourceKey: 'markedskalenderen',
      sourceUrl: url,
      sourceEventId: slug,
      title: title.replace(/\s*[-–]?\s*aflyst\s*!?\s*$/i, '').trim(),
      description,
      category: normalizeCategory(text('Markedstype')),
      venueName: text('Stedbeskrivelse'),
      street,
      postcode,
      city,
      municipality: text('Kommune'),
      organizer: text('Arrangør'),
      contactWebsite: website ?? undefined,
      contactEmail: text('E-mail'),
      contactPhone: text('Telefonnummer'),
      priceText,
      isFree: parseIsFree(priceText) ?? undefined,
      stallCountText: text('Antal stadepladser'),
      indoorOutdoor: normalizeIndoorOutdoor(text('Inden-/udendørs')),
      scheduleText,
      openingHoursText: text('Åbningstid'),
      dateRanges: dateRanges.length > 0 ? dateRanges : undefined,
      cancelled,
    };
  },
};
