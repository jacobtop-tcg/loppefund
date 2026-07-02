import { describe, expect, it } from 'vitest';
import {
  extractSydfynEvents,
  sydfynEventToRaw,
  sydfynskalenderen,
} from '../src/adapters/sydfynskalenderen.ts';
import type { FetchResult } from '../src/adapters/types.ts';

// Verbatim shape from the live homepage payload (HTML-entity-escaped JSON).
const ESCAPED_PAYLOAD = `
<div data-page="{&quot;events&quot;:[
{&quot;id&quot;:67631,&quot;slug&quot;:&quot;loppemarked-bazar-flyttesalg-privat-alt-skal-vaek-7&quot;,&quot;name&quot;:&quot;LOPPEMARKED - BAZAR - FLYTTESALG PRIVAT ALT SKAL V\\u00c6K&quot;,&quot;description&quot;:&quot;LOPPEMARKED - BAZAR - FLYTTESALG PRIVAT ALT skal v\\u00e6k.&quot;,&quot;place&quot;:{&quot;id&quot;:4421,&quot;name&quot;:&quot;Sarah Soli\\u00e5nd&quot;,&quot;address&quot;:&quot;Belvedere 3 B st.&quot;,&quot;zipCode&quot;:&quot;5700&quot;,&quot;city&quot;:&quot;Svendborg&quot;},&quot;startDate&quot;:&quot;2026-07-04T08:00:00.000000Z&quot;,&quot;endDate&quot;:&quot;2026-07-04T14:00:00.000000Z&quot;,&quot;time&quot;:null,&quot;priceType&quot;:2},
{&quot;id&quot;:67900,&quot;slug&quot;:&quot;sommerkoncert-i-praestegaarden&quot;,&quot;name&quot;:&quot;Sommerkoncert i Pr\\u00e6steg\\u00e5rden&quot;,&quot;description&quot;:&quot;Klassisk musik i haven.&quot;,&quot;place&quot;:{&quot;id&quot;:1,&quot;name&quot;:&quot;Pr\\u00e6steg\\u00e5rden&quot;,&quot;address&quot;:&quot;Kirkevej 1&quot;,&quot;zipCode&quot;:&quot;5700&quot;,&quot;city&quot;:&quot;Svendborg&quot;},&quot;startDate&quot;:&quot;2026-07-10T17:00:00.000000Z&quot;,&quot;endDate&quot;:&quot;2026-07-10T19:00:00.000000Z&quot;,&quot;time&quot;:null,&quot;priceType&quot;:1}
]}"></div>`;

describe('sydfynskalenderen adapter', () => {
  it('extracts records from escaped homepage JSON', () => {
    const events = extractSydfynEvents(ESCAPED_PAYLOAD);
    expect(events).toHaveLength(2);
    expect(events[0]!.place?.city).toBe('Svendborg');
  });

  it('maps the Svendborg garage sale with date but no invented times', () => {
    const [garage] = extractSydfynEvents(ESCAPED_PAYLOAD);
    const raw = sydfynEventToRaw(garage!);
    expect(raw).not.toBeNull();
    expect(raw!.sourceKey).toBe('sydfynskalenderen');
    expect(raw!.sourceUrl).toBe(
      'https://sydfynskalenderen.dk/begivenhed/loppemarked-bazar-flyttesalg-privat-alt-skal-vaek-7',
    );
    expect(raw!.street).toBe('Belvedere 3 B st.');
    expect(raw!.postcode).toBe('5700');
    expect(raw!.city).toBe('Svendborg');
    // TZ ambiguity: dates yes, times never guessed.
    expect(raw!.occurrences).toEqual([
      { date: '2026-07-04', startTime: null, endTime: null },
    ]);
    expect(raw!.category).toBe('loppemarked');
  });

  it('filters non-market events out', () => {
    const [, koncert] = extractSydfynEvents(ESCAPED_PAYLOAD);
    expect(sydfynEventToRaw(koncert!)).toBeNull();
  });

  it('fetchRawEvents runs end to end against a stubbed homepage', async () => {
    const stub = async (url: string): Promise<FetchResult> => ({
      url,
      status: 200,
      body: ESCAPED_PAYLOAD,
    });
    const raws = await sydfynskalenderen.fetchRawEvents!(stub);
    expect(raws).toHaveLength(1);
    expect(raws[0]!.title).toContain('LOPPEMARKED');
  });
});
