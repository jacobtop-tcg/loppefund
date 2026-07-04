// A one-click "add to calendar" link most people actually understand — a raw
// .ics download baffles non-technical visitors on desktop. Google Calendar opens
// a pre-filled event they just press Save on. .ics stays as the Apple/Outlook
// fallback. Pure + testable.

export interface CalEvent {
  title: string;
  date: string; // YYYY-MM-DD
  startTime: string | null; // "HH:MM"
  endTime: string | null;
  location?: string;
  details?: string;
}

function addDay(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/** A Google Calendar "add event" URL for one market occurrence. Times are stamped
 *  as Europe/Copenhagen (ctz); a market with no times becomes an all-day entry. */
export function googleCalendarUrl(e: CalEvent): string {
  const day = e.date.replaceAll('-', '');
  let dates: string;
  if (e.startTime && e.endTime) {
    const s = `${e.startTime.replace(':', '')}00`;
    const end = `${e.endTime.replace(':', '')}00`;
    dates = `${day}T${s}/${day}T${end}`;
  } else {
    // All-day events use an exclusive end date (the next day).
    dates = `${day}/${addDay(e.date).replaceAll('-', '')}`;
  }
  const params = new URLSearchParams({ action: 'TEMPLATE', text: e.title, dates, ctz: 'Europe/Copenhagen' });
  if (e.location) params.set('location', e.location);
  if (e.details) params.set('details', e.details);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
