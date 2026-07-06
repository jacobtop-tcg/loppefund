import { ImageResponse } from 'next/og';
import { loadEventDetail, listUpcomingEvents, todayIso } from '../../../lib/data.ts';
import {
  CATEGORY_LABELS,
  displayPlace,
  displayTitle,
  formatDateLong,
  formatHours,
} from '../../../lib/format.ts';

// One share card per event. Statically generated at build (nodejs runtime,
// compatible with output:export — edge is not). Mirrors the page route so
// only known slugs render; unknowns 404.
export const dynamicParams = false;

export function generateStaticParams(): Array<{ slug: string }> {
  return listUpcomingEvents(180).map((e) => ({ slug: e.slug }));
}

export const alt = 'Loppemarked på Loppefund';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const PAPER = '#faf5ec';
const INK = '#241f19';
const ACCENT = '#e4572e';
const ACCENT_DEEP = '#c73e18';

export default async function EventOgImage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const event = loadEventDetail(slug);
  const title = event ? displayTitle(event.title) : 'Loppemarked';
  const place = event ? [event.city ?? event.municipality].filter(Boolean)[0] : null;
  const category = event ? (CATEGORY_LABELS[event.category] ?? 'Marked') : 'Marked';
  const today = todayIso();
  const next = event?.occurrences.find((o) => o.date >= today) ?? event?.occurrences[0] ?? null;
  const dateLine = [
    next ? formatDateLong(next.date) : null,
    place ? displayPlace(place) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  // The details that make a shared link worth tapping — a scannable info row.
  const chips: string[] = [];
  const hours = next?.startTime ? formatHours(next.startTime, next.endTime) : null;
  if (hours) chips.push(hours);
  if (event?.isFree === true) chips.push('Gratis');
  else if (event?.priceText && event.priceText.length <= 16) chips.push(event.priceText);
  if (event?.indoorOutdoor === 'indoor') chips.push('Indendørs');
  else if (event?.indoorOutdoor === 'outdoor') chips.push('Udendørs');
  if (event?.amenities?.familyFriendly) chips.push('Børnevenligt');
  if (event?.stallCountText) chips.push(event.stallCountText);
  const shownChips = chips.slice(0, 4);

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: PAPER,
          color: INK,
          padding: '80px',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', fontSize: 44, fontWeight: 800, letterSpacing: -1, fontFamily: 'serif' }}>
          <span>Loppefund</span>
          <span style={{ color: ACCENT }}>.</span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              display: 'flex',
              alignSelf: 'flex-start',
              background: ACCENT,
              color: PAPER,
              fontSize: 26,
              fontWeight: 700,
              padding: '8px 22px',
              borderRadius: 999,
              marginBottom: 26,
            }}
          >
            {category}
          </div>
          <div
            style={{
              display: 'flex',
              fontSize: 78,
              fontWeight: 800,
              lineHeight: 1.05,
              letterSpacing: -2,
              fontFamily: 'serif',
              // Two-line clamp so long crawled titles never overflow the card.
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              maxHeight: 176,
            }}
          >
            {title}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              display: 'flex',
              fontSize: 40,
              fontWeight: 600,
              color: ACCENT_DEEP,
              marginBottom: shownChips.length > 0 ? 22 : 0,
            }}
          >
            {dateLine || 'Se datoer og praktisk info'}
          </div>
          {shownChips.length > 0 && (
            <div style={{ display: 'flex' }}>
              {shownChips.map((c, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    background: 'rgba(36, 31, 25, 0.06)',
                    color: INK,
                    fontSize: 30,
                    fontWeight: 600,
                    padding: '9px 22px',
                    borderRadius: 999,
                    marginRight: 16,
                  }}
                >
                  {c}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    ),
    size,
  );
}
