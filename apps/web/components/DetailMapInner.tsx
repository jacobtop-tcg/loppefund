'use client';

import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { loadMapStyle } from '../lib/map-style.ts';
import { MAP_LOCALE } from './MapView.tsx';

const PIN_SVG =
  '<svg width="34" height="44" viewBox="0 0 34 44" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
  '<path d="M17 42.5C17 42.5 31.5 26.4 31.5 15.9C31.5 7.8 25 1.5 17 1.5C9 1.5 2.5 7.8 2.5 15.9C2.5 26.4 17 42.5 17 42.5Z" fill="#c73e18" stroke="#fffdf8" stroke-width="2.6" stroke-linejoin="round"/>' +
  '<circle cx="17" cy="15.9" r="5" fill="#fffdf8"/>' +
  '</svg>';

export function DetailMapInner({
  lat,
  lng,
  approximate = false,
}: {
  lat: number;
  lng: number;
  approximate?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    let cancelled = false;
    let map: maplibregl.Map | null = null;
    loadMapStyle().then(({ style }) => {
      if (cancelled || !ref.current) return;
      map = new maplibregl.Map({
        container: ref.current,
        style,
        center: [lng, lat],
        // Approximate points zoom out a touch so the soft circle reads as an area.
        zoom: approximate ? 12 : 13.6,
        interactive: false,
        locale: MAP_LOCALE,
        attributionControl: { compact: true },
      });
      const el = document.createElement('div');
      if (approximate) {
        // No sharp pin — a soft radius that honestly says "somewhere in here".
        el.className = 'map-approx';
        el.style.cssText =
          'width:70px;height:70px;border-radius:50%;background:rgba(199,62,24,0.16);' +
          'border:2px dashed rgba(199,62,24,0.6);box-sizing:border-box;';
        new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([lng, lat]).addTo(map);
      } else {
        el.className = 'map-pin';
        el.innerHTML = PIN_SVG;
        new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([lng, lat]).addTo(map);
      }
    });
    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [lat, lng, approximate]);

  return <div ref={ref} style={{ height: '100%' }} />;
}
