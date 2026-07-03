/**
 * Adapter for olg.dk — Odsherreds Antik- og Kræmmermarked (OLG), a single
 * recurring market held every Sunday year-round in heated indoor halls at
 * Sneglerupvej 2, 4571 Grevinge. WordPress/Elementor site; no schema.org or
 * API, but the recurring schedule and address are cleanly labelled.
 *
 * As a dedicated single-market source it is high-trust for its own event
 * (0.7) and, being the organizer's own site, is the authority on its schedule.
 * robots.txt is absent (404), so crawling is allowed by default.
 */
import { parse, type HTMLElement } from 'node-html-parser';
import { extractPostcode, type RawEvent } from '@loppefund/core';
import type { SourceAdapter } from './types.ts';

const BASE = 'https://olg.dk';

/**
 * The value that follows a labelled heading. Elementor renders each label as a
 * heading widget with the value in the next sibling widget of the same
 * container, so climb to the widget wrapper and read the next element sibling.
 */
function valueForLabel(root: HTMLElement, label: string): string | undefined {
  const heading = root
    .querySelectorAll('h1, h2, h3, h4')
    .find((h) => h.text.trim().toLowerCase() === label.toLowerCase());
  if (!heading) return undefined;
  let widget: HTMLElement | null = heading;
  while (widget && !widget.classList.contains('elementor-widget')) {
    widget = widget.parentNode;
  }
  const siblings = (widget?.parentNode?.childNodes.filter((n) => 'tagName' in n && n.tagName) ??
    []) as HTMLElement[];
  const idx = siblings.indexOf(widget as HTMLElement);
  const value = siblings[idx + 1]?.text.replace(/\s+/g, ' ').trim();
  return value || undefined;
}

export const olg: SourceAdapter = {
  key: 'olg',
  name: 'Odsherreds Antik- og Kræmmermarked (OLG)',
  baseUrl: BASE,
  trust: 0.7,

  async discover(): Promise<string[]> {
    // A single-market site: one page describes the whole recurring market.
    return [`${BASE}/`];
  },

  extract(url: string, html: string): RawEvent | null {
    const root = parse(html);

    // The "Adresse" block is the anchor: if it is gone, the market page has
    // fundamentally changed and we emit nothing rather than guess (letting the
    // event auto-expire on a healthy crawl).
    const addressText = valueForLabel(root, 'Adresse');
    const postcode = addressText ? extractPostcode(addressText) ?? undefined : undefined;
    if (!addressText || !postcode) return null;

    // "Sneglerupvej 2, 4571 Grevinge" -> street / postcode / city.
    const parts = addressText.split(',').map((p) => p.trim()).filter(Boolean);
    const street = parts[0];
    const cityPart = parts.find((p) => /^[1-9]\d{3}\s+\S/.test(p));
    const city = cityPart?.replace(/^\d{4}\s*/, '').trim();

    // Title from the "Velkommen til …" hero heading; fall back to the known
    // market name so a copy tweak to the hero never drops the event.
    const welcome = root
      .querySelectorAll('h1, h2')
      .find((h) => /^velkommen til/i.test(h.text.trim()));
    const title =
      welcome?.text.replace(/\s+/g, ' ').replace(/^velkommen til\s*/i, '').trim() ||
      'Odsherreds Antik- og Kræmmermarked';

    // Opening hours as stated ("Alle søndage fra kl. 10-16"): the recurrence
    // phrase drives the schedule, the whole string yields the 10–16 window.
    const hoursText = valueForLabel(root, 'Åbningstider');
    const scheduleText = hoursText
      ? hoursText.replace(/\s*fra\s+kl\.?.*$/i, '').trim() || undefined
      : undefined;

    const bodyText = root.text.replace(/\s+/g, ' ');
    const phoneMatch = bodyText.match(/(?:telefon|tlf|sms|\+45)\D{0,6}((?:\d[ .]?){8})/i);
    const contactPhone = phoneMatch ? phoneMatch[1]!.replace(/\D/g, '') : undefined;
    const stallCountText = bodyText.match(/over\s*\d+\s*(?:standpladser|stadepladser)/i)?.[0];

    // Description: the intro paragraph — the text widget carrying the
    // "siden <year>" history line the hero always leads with.
    const description = root
      .querySelectorAll('.elementor-widget-text-editor')
      .map((w) => w.text.replace(/\s+/g, ' ').trim())
      .find((t) => /siden \d{4}/i.test(t));

    return {
      sourceKey: 'olg',
      sourceUrl: url,
      sourceEventId: 'odsherreds-antik-kraemmermarked',
      title,
      description,
      // "Antik- og Kræmmermarked": the name leads with "antik", but the site's
      // own prose ("et spændende kræmmermarked") and every other source classify
      // it as a kræmmermarked, so pin the type rather than let the title's
      // "antik" token win the category race.
      category: 'kraemmermarked',
      street,
      postcode,
      city,
      contactWebsite: `${BASE}/`,
      contactPhone,
      // The recurring Sunday market is held in the heated indoor halls.
      indoorOutdoor: 'indoor',
      stallCountText,
      scheduleText,
      openingHoursText: hoursText,
    };
  },
};
