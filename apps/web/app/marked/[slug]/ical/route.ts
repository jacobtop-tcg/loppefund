import {
  listUpcomingEvents,
  loadEventDetail,
  todayIso,
  UPCOMING_HORIZON_DAYS,
} from '../../../../lib/data.ts';

export const dynamicParams = false;

/** Pre-generate an .ics for every event (static export + dev). Same horizon as
 *  the page/city guides so a city-calendar VEVENT never links to a 404 detail. */
export function generateStaticParams(): Array<{ slug: string }> {
  return listUpcomingEvents(UPCOMING_HORIZON_DAYS).map((e) => ({ slug: e.slug }));
}

/** iCalendar export: every upcoming occurrence as a VEVENT. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const event = loadEventDetail(slug);
  if (!event) return new Response('Not found', { status: 404 });

  const today = todayIso();
  const upcoming = event.occurrences.filter((o) => o.date >= today).slice(0, 30);
  const location = [event.venueName, event.street, [event.postcode, event.city].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(', ');
  const esc = (s: string) =>
    s
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      // Collapse CR, LF, and CRLF to a single escaped newline so a raw \r from a
      // crawled/Facebook field can't corrupt the .ics line structure.
      .replace(/\r\n|\r|\n/g, '\\n');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';

  const vevents = upcoming.map((o) => {
    const day = o.date.replace(/-/g, '');
    const lines = [
      'BEGIN:VEVENT',
      `UID:${slug}-${o.date}@loppefund.dk`,
      `DTSTAMP:${stamp}`,
      o.startTime
        ? `DTSTART;TZID=Europe/Copenhagen:${day}T${o.startTime.replace(':', '')}00`
        : `DTSTART;VALUE=DATE:${day}`,
    ];
    if (o.startTime && o.endTime && o.endTime >= o.startTime) {
      lines.push(`DTEND;TZID=Europe/Copenhagen:${day}T${o.endTime.replace(':', '')}00`);
    }
    lines.push(
      `SUMMARY:${esc(event.title)}`,
      location ? `LOCATION:${esc(location)}` : '',
      event.lat != null && event.lng != null ? `GEO:${event.lat};${event.lng}` : '',
      `URL:${process.env.LOPPEFUND_BASE_URL ?? 'https://jacobtop-tcg.github.io/loppefund'}/marked/${slug}`,
      'END:VEVENT',
    );
    return lines.filter(Boolean).join('\r\n');
  });

  const body = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Loppefund//DA',
    ...vevents,
    'END:VCALENDAR',
  ].join('\r\n');

  return new Response(body, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `attachment; filename="${slug}.ics"`,
    },
  });
}
