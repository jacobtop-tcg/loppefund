import { listCities, listEventsForCity, todayIso } from '../../../../lib/data.ts';

export const dynamicParams = false;

/** Pre-generate a subscribable .ics feed for every city (static export + dev). */
export function generateStaticParams(): Array<{ city: string }> {
  return listCities().map((c) => ({ city: c.slug }));
}

const BASE = process.env.LOPPEFUND_BASE_URL ?? 'https://jacobtop-tcg.github.io/loppefund';

const esc = (s: string) =>
  s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');

/**
 * A SUBSCRIBABLE iCalendar feed of every upcoming market date in one city.
 * Delivers the mandate's "continuously monitor … NEW DATES … automatically" on
 * the consumer side: subscribe once (webcal), and every new date, time change or
 * cancellation the twice-daily crawl finds flows into the family's own calendar
 * with zero further action — something a per-event Facebook RSVP or a Google
 * search can't do. Cancelled markets are omitted (missing over incorrect).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ city: string }> }) {
  const { city } = await params;
  const info = listCities().find((c) => c.slug === city);
  if (!info) return new Response('Not found', { status: 404 });

  const today = todayIso();
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
  const vevents: string[] = [];
  for (const e of listEventsForCity(city)) {
    if (e.status === 'cancelled') continue;
    const location = [e.venueName, [e.postcode, e.city].filter(Boolean).join(' ')]
      .filter(Boolean)
      .join(', ');
    for (const o of e.occurrences.filter((o) => o.date >= today).slice(0, 20)) {
      const day = o.date.replace(/-/g, '');
      const lines = [
        'BEGIN:VEVENT',
        `UID:${e.slug}-${o.date}@loppefund.dk`,
        `DTSTAMP:${stamp}`,
        o.startTime
          ? `DTSTART;TZID=Europe/Copenhagen:${day}T${o.startTime.replace(':', '')}00`
          : `DTSTART;VALUE=DATE:${day}`,
      ];
      if (o.startTime && o.endTime && o.endTime >= o.startTime) {
        lines.push(`DTEND;TZID=Europe/Copenhagen:${day}T${o.endTime.replace(':', '')}00`);
      }
      lines.push(
        `SUMMARY:${esc(e.title)}`,
        location ? `LOCATION:${esc(location)}` : '',
        e.lat != null && e.lng != null ? `GEO:${e.lat};${e.lng}` : '',
        `URL:${BASE}/marked/${e.slug}`,
        'END:VEVENT',
      );
      vevents.push(lines.filter(Boolean).join('\r\n'));
    }
  }

  const body = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Loppefund//DA',
    `X-WR-CALNAME:Loppemarkeder i ${esc(info.city)}`,
    // Ask subscribing clients to re-poll twice a day — matches the crawl cadence.
    'REFRESH-INTERVAL;VALUE=DURATION:PT12H',
    'X-PUBLISHED-TTL:PT12H',
    ...vevents,
    'END:VCALENDAR',
  ].join('\r\n');

  return new Response(body, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="loppemarkeder-${city}.ics"`,
    },
  });
}
