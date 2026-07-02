import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { markedskalenderen } from '../src/adapters/markedskalenderen.ts';

const fixture = (name: string) =>
  readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf-8');

describe('markedskalenderen adapter', () => {
  it('extracts a full event from a real page', () => {
    const raw = markedskalenderen.extract(
      'https://markedskalenderen.dk/marked/show/broens-lopper',
      fixture('markedskalenderen-event.html'),
    );
    expect(raw).not.toBeNull();
    expect(raw!.title).toBe('Broens Lopper');
    expect(raw!.sourceEventId).toBe('broens-lopper');
    expect(raw!.category).toBe('loppemarked');
    expect(raw!.street).toBe('Strandgade 95');
    expect(raw!.postcode).toBe('1401');
    expect(raw!.city).toBe('København K');
    expect(raw!.municipality).toBe('København');
    expect(raw!.venueName).toBe('Broens Street Food, på kajen');
    expect(raw!.organizer).toBe('Broens Street Food');
    expect(raw!.indoorOutdoor).toBe('outdoor');
    expect(raw!.priceText).toBe('Gratis');
    expect(raw!.isFree).toBe(true);
    expect(raw!.stallCountText).toBe('26-50');
    expect(raw!.openingHoursText).toBe('Søndag 12-17');
    expect(raw!.scheduleText).toContain('ulige uger');
    expect(raw!.dateRanges).toHaveLength(8);
    expect(raw!.dateRanges![0]).toEqual({ start: '2026-07-05', end: '2026-07-05' });
    expect(raw!.contactWebsite).toBe('https://broensstreetfood.dk/events/');
    expect(raw!.contactEmail).toBe('kontakt@broensstreetfood.dk');
    expect(raw!.contactPhone).toBe('33930760');
    expect(raw!.description).toContain('fast tradition');
    expect(raw!.cancelled).toBeUndefined();
  });

  it('extracts a one-off event using the singular "Periode:" label', () => {
    const raw = markedskalenderen.extract(
      'https://markedskalenderen.dk/marked/show/allan-larsen',
      fixture('markedskalenderen-event-single.html'),
    );
    expect(raw).not.toBeNull();
    expect(raw!.category).toBe('byloppemarked');
    expect(raw!.street).toBe('Kongevej 2');
    expect(raw!.postcode).toBe('4450');
    expect(raw!.dateRanges).toEqual([{ start: '2026-07-04', end: '2026-07-05' }]);
    expect(raw!.openingHoursText).toContain('9-17');
    expect(raw!.isFree).toBe(true);
  });

  it('finds event links on a category page', () => {
    const html = fixture('markedskalenderen-category.html');
    const links = [...html.matchAll(
      /href="(https:\/\/markedskalenderen\.dk\/marked\/show\/[a-z0-9-]+)"/g,
    )].map((m) => m[1]);
    expect(new Set(links).size).toBeGreaterThan(3);
  });
});
