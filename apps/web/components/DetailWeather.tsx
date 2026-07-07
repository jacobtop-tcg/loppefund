'use client';

import { useDayWeather, weatherGlyph } from '../lib/weather.ts';

/**
 * Forecast line in the detail hero for OUTDOOR markets — "regner det på
 * lørdag?" decides the trip, and the list cards already answer it. Client-only
 * (Open-Meteo, same session cache as the list); renders nothing for indoor
 * markets, unknown coords, dates beyond the ~16-day horizon, or while loading
 * — the static HTML never carries a baked-in, stale forecast.
 */
export function DetailWeather({
  lat,
  lng,
  date,
  indoorOutdoor,
  weatherDependent,
}: {
  lat: number | null;
  lng: number | null;
  date: string;
  indoorOutdoor: string;
  weatherDependent: boolean;
}) {
  const outdoor =
    indoorOutdoor === 'outdoor' || indoorOutdoor === 'mixed' || weatherDependent;
  const day = useDayWeather(lat, lng, date, outdoor);
  if (!day) return null;
  const g = weatherGlyph(day.code);
  const warn = weatherDependent && day.popPct >= 50;
  return (
    <p className="detail-weather">
      <span aria-hidden>{g.emoji}</span> {g.label} · {day.tmaxC}° · {day.popPct} % regn
      {warn && (
        <span className="detail-weather-warn">
          Aflyses typisk ved regn — tjek hos arrangøren på dagen
        </span>
      )}
    </p>
  );
}
