'use client';

import { useEffect, useState } from 'react';
import { copenhagenNow, parseOsmHours, type CphNow } from '@loppefund/core';
import { openLabel, venueOpenState } from '../lib/venue-client.ts';

const DAY_NAMES = ['Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag', 'Søndag'];

const fmt = (min: number) =>
  `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

function weekdayMon0(isoDate: string): number {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  return (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7;
}

/**
 * The opening-hours block on a venue page: a live "Åbent nu / åbner kl. X" line
 * plus the full week, with today highlighted. Seeds from the build clock (so the
 * static HTML matches the first client render) then ticks live.
 */
export function VenueHours({ hoursText, buildNow }: { hoursText: string | null; buildNow: CphNow }) {
  const [now, setNow] = useState<CphNow>(buildNow);
  useEffect(() => {
    setNow(copenhagenNow());
    const id = setInterval(() => setNow(copenhagenNow()), 60_000);
    return () => clearInterval(id);
  }, []);

  const label = openLabel(venueOpenState(hoursText, now), now);
  const week = parseOsmHours(hoursText);
  const todayIdx = weekdayMon0(now.date);

  return (
    <div className="venue-hours">
      {label ? (
        <div className={`venue-hours-state${label.open ? ' is-open' : ''}`}>
          {label.open && <span className="dot" aria-hidden />}
          {label.text}
        </div>
      ) : (
        <div className="venue-hours-state is-unknown">Åbningstider ikke oplyst på OpenStreetMap</div>
      )}
      {week && (
        <table className="venue-hours-table">
          <tbody>
            {DAY_NAMES.map((name, i) => (
              <tr key={i} className={i === todayIdx ? 'is-today' : ''}>
                <th scope="row">{name}</th>
                <td>
                  {week[i]!.length === 0
                    ? 'Lukket'
                    : week[i]!.map((r) => `${fmt(r[0])}–${fmt(r[1])}`).join(', ')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
