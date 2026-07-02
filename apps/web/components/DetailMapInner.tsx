'use client';

import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

export function DetailMapInner({ lat, lng }: { lat: number; lng: number }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const map = new maplibregl.Map({
      container: ref.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: 'raster',
            tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '© OpenStreetMap-bidragydere',
          },
        },
        layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
      },
      center: [lng, lat],
      zoom: 13.5,
      interactive: false,
      attributionControl: { compact: true },
    });
    const el = document.createElement('div');
    el.style.cssText =
      'width:18px;height:18px;border-radius:50%;background:#c73e18;border:3px solid #faf5ec;box-shadow:0 2px 8px rgba(0,0,0,.35)';
    new maplibregl.Marker({ element: el }).setLngLat([lng, lat]).addTo(map);
    return () => map.remove();
  }, [lat, lng]);

  return <div ref={ref} style={{ height: '100%' }} />;
}
