'use client';

// Weekend weather for OUTDOOR markets — the single biggest "worth driving to?"
// factor for open-air flea markets. Client-side only, from Open-Meteo (free, no
// key, CORS-enabled). Non-blocking and fully optional: if it fails or a date is
// beyond the ~16-day forecast horizon, the card simply shows no weather.
import { useEffect, useState } from 'react';

export interface DayWeather {
  code: number;
  tmaxC: number;
  popPct: number; // max precipitation probability, 0..100
}

/** WMO weather code -> a compact emoji + short Danish label. */
export function weatherGlyph(code: number): { emoji: string; label: string } {
  if (code === 0) return { emoji: '☀️', label: 'Klart' };
  if (code <= 2) return { emoji: '🌤️', label: 'Let skyet' };
  if (code === 3) return { emoji: '☁️', label: 'Skyet' };
  if (code <= 48) return { emoji: '🌫️', label: 'Tåget' };
  if (code <= 57) return { emoji: '🌦️', label: 'Finregn' };
  if (code <= 67) return { emoji: '🌧️', label: 'Regn' };
  if (code <= 77) return { emoji: '🌨️', label: 'Sne' };
  if (code <= 82) return { emoji: '🌧️', label: 'Byger' };
  if (code <= 86) return { emoji: '🌨️', label: 'Snebyger' };
  return { emoji: '⛈️', label: 'Torden' };
}

// One fetch per ~0.5° grid cell (≈30-50 km) — markets cluster in towns, so a
// screenful of markets resolves to a handful of cells. Cached for the session.
const CELL = 0.5;
const cache = new Map<string, Promise<Map<string, DayWeather>>>();

function cellKey(lat: number, lng: number): string {
  const r = (n: number) => (Math.round(n / CELL) * CELL).toFixed(2);
  return `${r(lat)},${r(lng)}`;
}

async function fetchCell(key: string): Promise<Map<string, DayWeather>> {
  const [lat, lng] = key.split(',');
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
    `&daily=weather_code,temperature_2m_max,precipitation_probability_max` +
    `&timezone=Europe%2FCopenhagen&forecast_days=16`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`weather ${res.status}`);
  const j = (await res.json()) as {
    daily?: {
      time?: string[];
      weather_code?: number[];
      temperature_2m_max?: number[];
      precipitation_probability_max?: (number | null)[];
    };
  };
  const d = j.daily;
  const out = new Map<string, DayWeather>();
  for (let i = 0; i < (d?.time?.length ?? 0); i++) {
    out.set(d!.time![i]!, {
      code: d!.weather_code?.[i] ?? 0,
      tmaxC: Math.round(d!.temperature_2m_max?.[i] ?? 0),
      popPct: d!.precipitation_probability_max?.[i] ?? 0,
    });
  }
  return out;
}

function cellWeather(lat: number, lng: number): Promise<Map<string, DayWeather>> {
  const key = cellKey(lat, lng);
  let p = cache.get(key);
  if (!p) {
    p = fetchCell(key).catch(() => new Map<string, DayWeather>()); // degrade to none
    cache.set(key, p);
  }
  return p;
}

interface WxEvent {
  slug: string;
  lat: number | null;
  lng: number | null;
  nextDate: string;
  indoorOutdoor: string;
  /** A market that "aflyses ved regn" is by definition outdoor — fetch its
   *  forecast even when the indoor/outdoor field was never filled in. */
  weatherDependent?: boolean;
}

/**
 * Resolve forecast for the OUTDOOR markets currently shown, keyed by slug for
 * the card to look up. Runs after render, dedupes to grid cells, and never
 * throws — an empty map just means no weather is shown.
 */
export function useOutdoorWeather(events: WxEvent[]): Map<string, DayWeather> {
  const [weather, setWeather] = useState<Map<string, DayWeather>>(new Map());

  // A cheap, stable signature so the effect only re-runs when the outdoor set
  // or its dates actually change (not on every hover-driven re-render).
  const outdoor = events.filter(
    (e) =>
      (e.indoorOutdoor === 'outdoor' || e.indoorOutdoor === 'mixed' || e.weatherDependent === true) &&
      e.lat != null &&
      e.lng != null,
  );
  const sig = outdoor.map((e) => `${e.slug}:${e.nextDate}`).join(',');

  useEffect(() => {
    if (outdoor.length === 0) {
      setWeather(new Map());
      return;
    }
    let cancelled = false;
    Promise.all(
      outdoor.slice(0, 500).map(async (e) => {
        const cell = await cellWeather(e.lat!, e.lng!);
        const day = cell.get(e.nextDate);
        return day ? ([e.slug, day] as const) : null;
      }),
    ).then((pairs) => {
      if (!cancelled) setWeather(new Map(pairs.filter((p): p is readonly [string, DayWeather] => p !== null)));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);

  return weather;
}
