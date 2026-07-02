'use client';

import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { EventSummary } from '../lib/data.ts';
import { CATEGORY_LABELS, formatDateLong } from '../lib/format.ts';

const DENMARK_CENTER: [number, number] = [10.6, 56.05];

const MAP_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  // Required for symbol layers (cluster counts).
  glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap-bidragydere',
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
};

type MapEvent = EventSummary & { nextDate: string };

function toGeoJson(events: MapEvent[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: events
      .filter((e) => e.lat != null && e.lng != null)
      .map((e) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [e.lng!, e.lat!] },
        properties: {
          slug: e.slug,
          title: e.title,
          city: e.city ?? '',
          category: CATEGORY_LABELS[e.category] ?? 'Marked',
          nextDate: e.nextDate,
        },
      })),
  };
}

export function MapView({ events }: { events: MapEvent[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const readyRef = useRef(false);
  // The 'load' handler runs asynchronously; read the latest events from a ref
  // so filters applied before the map finishes loading aren't lost.
  const eventsRef = useRef(events);
  eventsRef.current = events;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      center: DENMARK_CENTER,
      zoom: 6.1,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.on('load', () => {
      map.addSource('events', {
        type: 'geojson',
        data: toGeoJson(eventsRef.current),
        cluster: true,
        clusterMaxZoom: 12,
        clusterRadius: 46,
      });
      map.addLayer({
        id: 'clusters',
        type: 'circle',
        source: 'events',
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': '#e4572e',
          'circle-radius': ['step', ['get', 'point_count'], 16, 10, 21, 40, 27],
          'circle-stroke-width': 3,
          'circle-stroke-color': '#faf5ec',
        },
      });
      map.addLayer({
        id: 'cluster-count',
        type: 'symbol',
        source: 'events',
        filter: ['has', 'point_count'],
        layout: {
          'text-field': ['get', 'point_count_abbreviated'],
          'text-size': 13,
          'text-font': ['Noto Sans Regular'],
        },
        paint: { 'text-color': '#ffffff' },
      });
      map.addLayer({
        id: 'points',
        type: 'circle',
        source: 'events',
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-color': '#c73e18',
          'circle-radius': 8,
          'circle-stroke-width': 2.5,
          'circle-stroke-color': '#faf5ec',
        },
      });
      map.on('click', 'clusters', async (e) => {
        const feature = map.queryRenderedFeatures(e.point, { layers: ['clusters'] })[0];
        if (!feature) return;
        const source = map.getSource('events') as maplibregl.GeoJSONSource;
        const zoom = await source.getClusterExpansionZoom(feature.properties!.cluster_id as number);
        map.easeTo({
          center: (feature.geometry as GeoJSON.Point).coordinates as [number, number],
          zoom,
        });
      });
      map.on('click', 'points', (e) => {
        const f = e.features?.[0];
        if (!f) return;
        const p = f.properties as Record<string, string>;
        new maplibregl.Popup({ offset: 14, className: 'map-popup' })
          .setLngLat((f.geometry as GeoJSON.Point).coordinates as [number, number])
          .setHTML(
            `<div class="map-popup-title">${escapeHtml(p.title!)}</div>` +
              `<div class="map-popup-meta">${escapeHtml(p.category!)}${p.city ? ` · ${escapeHtml(p.city)}` : ''} · ${formatDateLong(p.nextDate!)}</div>` +
              `<a class="map-popup-link" href="/marked/${encodeURIComponent(p.slug!)}">Se marked →</a>`,
          )
          .addTo(map);
      });
      for (const layer of ['clusters', 'points']) {
        map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'));
        map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = ''));
      }
      readyRef.current = true;
    });
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
      readyRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep data in sync with active filters.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    (map.getSource('events') as maplibregl.GeoJSONSource | undefined)?.setData(
      toGeoJson(events),
    );
  }, [events]);

  return <div ref={containerRef} className="map-shell" />;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
