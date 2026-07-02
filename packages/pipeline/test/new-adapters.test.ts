import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { decodeEntities, tribeEventToRaw } from '../src/adapters/loppemarkeder-nu.ts';
import {
  extractSchemaEvent,
  findmarked,
  joinFlightPayload,
} from '../src/adapters/findmarked.ts';

describe('loppemarkeder.nu adapter', () => {
  it('decodes HTML entities', () => {
    expect(decodeEntities('Marked &#8211; Kirke Hyllinge')).toBe('Marked – Kirke Hyllinge');
    expect(decodeEntities('B&amp;O &quot;lopper&quot;')).toBe('B&O "lopper"');
  });

  it('converts a tribe event to a RawEvent', () => {
    const raw = tribeEventToRaw({
      id: 102507,
      title: 'Marked &#8211; Kirke Hyllinge',
      description: '<p>Hyggeligt marked<br/>med boder</p>',
      url: 'https://loppemarkeder.nu/loppemarked/marked/',
      start_date: '2026-07-02 12:00:00',
      end_date: '2026-07-02 15:00:00',
      all_day: false,
      cost: 'Gratis',
      website: 'https://www.facebook.com/events/1086151306315308/',
      categories: [{ slug: 'loppemarked' }],
      venue: { venue: 'Brusagervej 1, 4070 Kirke Hyllinge, Danmark', address: 'Brusagervej 1, 4070 Kirke Hyllinge, Danmark' },
    });
    expect(raw.title).toBe('Marked – Kirke Hyllinge');
    expect(raw.street).toBe('Brusagervej 1');
    expect(raw.postcode).toBe('4070');
    expect(raw.city).toBe('Kirke Hyllinge');
    expect(raw.category).toBe('loppemarked');
    expect(raw.isFree).toBe(true);
    expect(raw.description).toBe('Hyggeligt marked\nmed boder');
    expect(raw.occurrences).toEqual([
      { date: '2026-07-02', startTime: '12:00', endTime: '15:00' },
    ]);
  });

  it('spans multi-day events into per-day occurrences', () => {
    const raw = tribeEventToRaw({
      id: 1,
      title: 'Weekendmarked',
      url: 'https://loppemarkeder.nu/loppemarked/x/',
      start_date: '2026-07-04 10:00:00',
      end_date: '2026-07-05 16:00:00',
      all_day: false,
    });
    expect(raw.occurrences!.map((o) => o.date)).toEqual(['2026-07-04', '2026-07-05']);
  });
});

describe('findmarked adapter', () => {
  const html = readFileSync(
    join(import.meta.dirname, 'fixtures', 'findmarked-event.html'),
    'utf-8',
  );

  it('reassembles flight payload and extracts the schema.org Event', () => {
    const payload = joinFlightPayload(html);
    const event = extractSchemaEvent(payload);
    expect(event).not.toBeNull();
    expect(event!.name).toBe('Broens Lopper');
    expect(event!.location?.geo?.latitude).toBeCloseTo(55.6779, 3);
  });

  it('extracts a full RawEvent from a real page', () => {
    const raw = findmarked.extract('https://findmarked.dk/marked/broens-lopper', html);
    expect(raw).not.toBeNull();
    expect(raw!.title).toBe('Broens Lopper');
    expect(raw!.street).toBe('Strandgade 95');
    expect(raw!.postcode).toBe('1401');
    expect(raw!.city).toBe('København K');
    expect(raw!.lat).toBeCloseTo(55.6779, 3);
    expect(raw!.lng).toBeCloseTo(12.5968, 3);
    expect(raw!.category).toBe('loppemarked');
    expect(raw!.occurrences![0]).toEqual({
      date: '2026-07-05',
      startTime: '10:00',
      endTime: '16:00',
    });
  });
});
