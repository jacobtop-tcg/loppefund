'use client';

import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { EventSummary, VenueSummary } from '../lib/data.ts';
import {
  CATEGORY_LABELS,
  dayOfMonth,
  displayTitle,
  formatDateLong,
  formatHours,
  weekdayShort,
} from '../lib/format.ts';
import { VENUE_LABELS } from '../lib/venue-client.ts';
import { loadMapStyle, MAP } from '../lib/map-style.ts';

// Permanent venues get their own petrol-teal palette so they read instantly as
// a different layer from the terracotta market pins.
const VENUE_COLOR = '#2f6f6a';
const VENUE_OPEN = '#3e7a4e';
const VENUE_HALO = 'rgba(47, 111, 106, 0.18)';

type MapVenue = VenueSummary & { open?: boolean };

function toVenueGeoJson(venues: MapVenue[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: venues
      .filter((v) => v.lat != null && v.lng != null)
      .map((v) => ({
        type: 'Feature' as const,
        geometry: { type: 'Point' as const, coordinates: [v.lng!, v.lat!] },
        properties: {
          slug: v.slug,
          title: displayTitle(v.title),
          city: v.city ?? '',
          vtype: VENUE_LABELS[v.category] ?? 'Fast butik',
          open: v.open ? 1 : 0,
        },
      })),
  };
}

const DENMARK_CENTER: [number, number] = [10.6, 56.05];
const DENMARK_ZOOM = 6.1;
const FIT_DEBOUNCE_MS = 350;

// Danish translations for maplibre's built-in UI strings (gesture overlay,
// control tooltips) so nothing renders in English on this lang="da" site.
export const MAP_LOCALE: Record<string, string> = {
  'ScrollZoomBlocker.CtrlMessage': 'Brug ctrl + scroll for at zoome',
  'ScrollZoomBlocker.CmdMessage': 'Brug ⌘ + scroll for at zoome',
  'TouchPanBlocker.Message': 'Brug to fingre for at flytte kortet',
  'NavigationControl.ZoomIn': 'Zoom ind',
  'NavigationControl.ZoomOut': 'Zoom ud',
  'GeolocateControl.FindMyLocation': 'Find min placering',
  'GeolocateControl.LocationNotAvailable': 'Placering ikke tilgængelig',
};

type MapEvent = EventSummary & { nextDate: string; openNow?: boolean };

function toGeoJson(events: MapEvent[], today: string): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: events
      .filter((e) => e.lat != null && e.lng != null)
      .map((e) => {
        const next = e.occurrences.find((o) => o.date === e.nextDate);
        const isToday = e.nextDate === today;
        return {
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: [e.lng!, e.lat!] },
          properties: {
            slug: e.slug,
            title: displayTitle(e.title),
            city: e.city ?? '',
            category: CATEGORY_LABELS[e.category] ?? 'Marked',
            nextDate: e.nextDate,
            hours: next ? (formatHours(next.startTime, next.endTime) ?? '') : '',
            isFree: e.isFree === true,
            // Drives marker color + label: green 'Åbent nu' > accent 'i dag' > accent-deep
            state: e.openNow ? 'open' : isToday ? 'today' : 'upcoming',
            label: isToday ? 'i dag' : `${weekdayShort(e.nextDate)} ${dayOfMonth(e.nextDate)}.`,
          },
        };
      }),
  };
}

function applyHighlight(map: maplibregl.Map, slug: string | null): void {
  map.setFilter(
    'point-highlight',
    slug
      ? ['all', ['!', ['has', 'point_count']], ['==', ['get', 'slug'], slug]]
      : ['boolean', false],
  );
}

function applySelected(map: maplibregl.Map, slugs: string[]): void {
  map.setFilter(
    'points-selected',
    slugs.length
      ? ['all', ['!', ['has', 'point_count']], ['in', ['get', 'slug'], ['literal', slugs]]]
      : ['boolean', false],
  );
}

export function MapView({
  events,
  venues = [],
  today,
  highlightSlug = null,
  tripMode = false,
  tripSlugs = [],
  onToggleTrip,
  fullscreen = false,
}: {
  events: MapEvent[];
  venues?: MapVenue[];
  today: string;
  highlightSlug?: string | null;
  tripMode?: boolean;
  tripSlugs?: string[];
  onToggleTrip?: (slug: string) => void;
  fullscreen?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const readyRef = useRef(false);
  // Two signatures of the last render. The SET signature (which markers) gates
  // the fly-to refit; the STATE signature (marker colours/labels, which the
  // live clock flips) gates the repaint. Splitting them lets an open/today
  // state change repaint the markers without yanking the map.
  const lastSetSigRef = useRef<string | null>(null);
  const lastStateSigRef = useRef<string | null>(null);
  const fitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The style fetch and 'load' handler run asynchronously; read the latest
  // events from a ref so filters applied before then aren't lost.
  const eventsRef = useRef(events);
  eventsRef.current = events;
  const venuesRef = useRef(venues);
  venuesRef.current = venues;
  const lastVenueSigRef = useRef<string | null>(null);
  // The popup click handler is bound once at load — read live trip state here.
  const tripRef = useRef({ tripMode, tripSlugs, onToggleTrip });
  tripRef.current = { tripMode, tripSlugs, onToggleTrip };
  const highlightRef = useRef(highlightSlug);
  highlightRef.current = highlightSlug;

  function syncVenues(map: maplibregl.Map, vns: MapVenue[]) {
    const data = toVenueGeoJson(vns);
    const sig = data.features
      .map((f) => `${f.properties!.slug}:${f.properties!.open}`)
      .sort()
      .join(',');
    if (sig === lastVenueSigRef.current) return;
    lastVenueSigRef.current = sig;
    (map.getSource('venues') as maplibregl.GeoJSONSource | undefined)?.setData(data);
  }

  function syncData(map: maplibregl.Map, evts: MapEvent[], animate: boolean) {
    const data = toGeoJson(evts, today);
    // Order-independent SET signature: pure re-orderings (gemsFirst, distance
    // sort) don't change the set, so they must not trigger a refit.
    const setSig = data.features
      .map((f) => f.properties!.slug as string)
      .sort()
      .join(',');
    // STATE signature: the marker visuals the live clock flips (open/today
    // colour + label) even when the set is unchanged. Repaint on any change.
    const stateSig = data.features
      .map((f) => `${f.properties!.slug}:${f.properties!.state}:${f.properties!.label}`)
      .sort()
      .join('|');
    if (stateSig === lastStateSigRef.current) return; // nothing changed at all
    const first = lastSetSigRef.current === null;
    const setChanged = setSig !== lastSetSigRef.current;
    lastStateSigRef.current = stateSig;
    lastSetSigRef.current = setSig;
    (map.getSource('events') as maplibregl.GeoJSONSource | undefined)?.setData(data);
    if (fitTimerRef.current) {
      clearTimeout(fitTimerRef.current);
      fitTimerRef.current = null;
    }
    // Fly to the filtered result set — but only when the SET changed (never on a
    // clock-driven state-only repaint), never on the initial Denmark frame, and
    // never into an empty set. Debounced so typing doesn't yank the map.
    if (!animate || first || !setChanged || data.features.length === 0) return;
    const coords = data.features.map(
      (f) => (f.geometry as GeoJSON.Point).coordinates as [number, number],
    );
    fitTimerRef.current = setTimeout(() => {
      fitTimerRef.current = null;
      if (coords.length === 1) {
        map.easeTo({ center: coords[0]!, zoom: 11, duration: 650 });
        return;
      }
      const bounds = new maplibregl.LngLatBounds();
      for (const c of coords) bounds.extend(c);
      map.fitBounds(bounds, {
        padding: { top: 64, right: 56, bottom: 56, left: 56 },
        maxZoom: 11,
        duration: 700,
      });
    }, FIT_DEBOUNCE_MS);
  }

  useEffect(() => {
    const container = containerRef.current;
    if (!container || mapRef.current) return;
    let cancelled = false;
    let map: maplibregl.Map | null = null;
    let ro: ResizeObserver | null = null;
    loadMapStyle().then(({ style, fonts }) => {
      if (cancelled) return;
      map = new maplibregl.Map({
        container,
        style,
        center: DENMARK_CENTER,
        zoom: DENMARK_ZOOM,
        locale: MAP_LOCALE,
        attributionControl: { compact: true },
        cooperativeGestures:
          typeof window !== 'undefined' && window.matchMedia('(max-width: 899px)').matches,
      });
      mapRef.current = map;
      // Keep maplibre's canvas sized to its container across the mobile
      // hero <-> fullscreen toggle (the desktop pane is a fixed sticky size).
      // resize() is a no-op when dimensions are unchanged, so this is cheap.
      ro = new ResizeObserver(() => map?.resize());
      ro.observe(container);
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
      map.addControl(
        new maplibregl.GeolocateControl({
          positionOptions: { enableHighAccuracy: false, timeout: 8000 },
          fitBoundsOptions: { maxZoom: 12 },
        }),
        'top-right',
      );
      map.on('load', () => {
        const m = map!;
        m.addSource('events', {
          type: 'geojson',
          data: toGeoJson(eventsRef.current, today),
          cluster: true,
          clusterMaxZoom: 12,
          clusterRadius: 46,
        });
        // Soft warm glow behind clusters — reads as 'many markets here'.
        m.addLayer({
          id: 'cluster-halo',
          type: 'circle',
          source: 'events',
          filter: ['has', 'point_count'],
          paint: {
            'circle-color': 'rgba(228, 87, 46, 0.18)',
            'circle-radius': ['step', ['get', 'point_count'], 23, 10, 28, 40, 35],
            'circle-blur': 0.35,
          },
        });
        m.addLayer({
          id: 'clusters',
          type: 'circle',
          source: 'events',
          filter: ['has', 'point_count'],
          paint: {
            'circle-color': ['step', ['get', 'point_count'], MAP.accent, 40, MAP.accentDeep],
            'circle-radius': ['step', ['get', 'point_count'], 16, 10, 21, 40, 27],
            'circle-stroke-width': 2.5,
            'circle-stroke-color': MAP.paperRaised,
          },
        });
        m.addLayer({
          id: 'cluster-count',
          type: 'symbol',
          source: 'events',
          filter: ['has', 'point_count'],
          layout: {
            'text-field': ['get', 'point_count_abbreviated'],
            'text-size': 13,
            'text-font': fonts.bold,
            'text-allow-overlap': true, // counts must never be culled
          },
          paint: { 'text-color': MAP.paperRaised },
        });
        // State halo: only 'Åbent nu' and 'i dag' points glow — zero clutter.
        m.addLayer({
          id: 'point-halo',
          type: 'circle',
          source: 'events',
          filter: ['!', ['has', 'point_count']],
          paint: {
            'circle-radius': 15,
            'circle-blur': 0.5,
            'circle-color': [
              'match', ['get', 'state'],
              'open', 'rgba(62, 122, 78, 0.28)',
              'today', 'rgba(228, 87, 46, 0.22)',
              'rgba(0, 0, 0, 0)',
            ],
          },
        });
        m.addLayer({
          id: 'points',
          type: 'circle',
          source: 'events',
          filter: ['!', ['has', 'point_count']],
          paint: {
            'circle-color': [
              'match', ['get', 'state'],
              'open', MAP.green,
              'today', MAP.accent,
              MAP.accentDeep,
            ],
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 5.5, 10, 7.5, 14, 9],
            'circle-stroke-width': 2.5,
            'circle-stroke-color': MAP.paperRaised,
          },
        });
        // Trip-mode selected stops: ink dots so the route reads at a glance.
        m.addLayer({
          id: 'points-selected',
          type: 'circle',
          source: 'events',
          filter: ['boolean', false],
          paint: {
            'circle-color': MAP.ink,
            'circle-radius': 9,
            'circle-stroke-width': 2.5,
            'circle-stroke-color': MAP.paper,
          },
        });
        // Card hover/focus -> marker highlight (filter by slug; feature-state
        // is unreliable with clustered GeoJSON).
        m.addLayer({
          id: 'point-highlight',
          type: 'circle',
          source: 'events',
          filter: ['boolean', false],
          paint: {
            'circle-color': MAP.accent,
            'circle-radius': 12,
            'circle-stroke-width': 3,
            'circle-stroke-color': MAP.paperRaised,
          },
        });
        // Weekday label under each dot ('lør 5.' / 'i dag'). Chosen over DOM
        // date-pills: at 615 points GL symbols cost nothing, and MapLibre's
        // collision engine hides crowded labels instead of overlapping them.
        m.addLayer({
          id: 'point-labels',
          type: 'symbol',
          source: 'events',
          filter: ['!', ['has', 'point_count']],
          minzoom: 8, // country view stays clean
          layout: {
            'text-field': ['get', 'label'],
            'text-font': fonts.regular,
            'text-size': 11.5,
            'text-anchor': 'top',
            'text-offset': [0, 0.9],
          },
          paint: {
            'text-color': [
              'match', ['get', 'state'],
              'open', MAP.green,
              'today', MAP.accentDeep,
              MAP.inkSoft,
            ],
            'text-halo-color': MAP.paper,
            'text-halo-width': 1.4,
          },
        });
        m.on('click', 'clusters', async (e) => {
          const feature = m.queryRenderedFeatures(e.point, { layers: ['clusters'] })[0];
          if (!feature) return;
          const source = m.getSource('events') as maplibregl.GeoJSONSource;
          const zoom = await source.getClusterExpansionZoom(
            feature.properties!.cluster_id as number,
          );
          m.easeTo({
            center: (feature.geometry as GeoJSON.Point).coordinates as [number, number],
            zoom,
            duration: 500,
          });
        });
        const openPopup = (e: maplibregl.MapLayerMouseEvent) => {
          const f = e.features?.[0];
          if (!f) return;
          const p = f.properties as Record<string, unknown>;
          const slug = String(p.slug);
          const { tripMode: inTrip, tripSlugs: selectedSlugs } = tripRef.current;
          const popup = new maplibregl.Popup({ offset: 16, className: 'map-popup', maxWidth: '272px' })
            .setLngLat((f.geometry as GeoJSON.Point).coordinates as [number, number])
            .setHTML(popupHtml(p, { active: inTrip, selected: selectedSlugs.includes(slug) }))
            .addTo(m);
          // Popup removal on toggle keeps the button label trivially correct.
          popup
            .getElement()
            ?.querySelector('.map-popup-add')
            ?.addEventListener('click', () => {
              tripRef.current.onToggleTrip?.(slug);
              popup.remove();
            });
        };
        m.on('click', 'points', openPopup);
        m.on('click', 'point-labels', openPopup);
        for (const layer of ['clusters', 'points', 'point-labels']) {
          m.on('mouseenter', layer, () => (m.getCanvas().style.cursor = 'pointer'));
          m.on('mouseleave', layer, () => (m.getCanvas().style.cursor = ''));
        }

        // Permanent-venue layer: its own petrol-teal source, clustered like the
        // markets but visually distinct so the two never read as one thing.
        m.addSource('venues', {
          type: 'geojson',
          data: toVenueGeoJson(venuesRef.current),
          cluster: true,
          clusterMaxZoom: 12,
          clusterRadius: 44,
        });
        m.addLayer({
          id: 'venue-cluster-halo',
          type: 'circle',
          source: 'venues',
          filter: ['has', 'point_count'],
          paint: {
            'circle-color': VENUE_HALO,
            'circle-radius': ['step', ['get', 'point_count'], 20, 10, 26, 40, 32],
            'circle-blur': 0.4,
          },
        });
        m.addLayer({
          id: 'venue-clusters',
          type: 'circle',
          source: 'venues',
          filter: ['has', 'point_count'],
          paint: {
            'circle-color': VENUE_COLOR,
            'circle-radius': ['step', ['get', 'point_count'], 14, 10, 19, 40, 25],
            'circle-stroke-width': 2.5,
            'circle-stroke-color': MAP.paperRaised,
          },
        });
        m.addLayer({
          id: 'venue-cluster-count',
          type: 'symbol',
          source: 'venues',
          filter: ['has', 'point_count'],
          layout: {
            'text-field': ['get', 'point_count_abbreviated'],
            'text-size': 12,
            'text-font': fonts.bold,
            'text-allow-overlap': true,
          },
          paint: { 'text-color': MAP.paperRaised },
        });
        m.addLayer({
          id: 'venue-points',
          type: 'circle',
          source: 'venues',
          filter: ['!', ['has', 'point_count']],
          paint: {
            'circle-color': ['case', ['==', ['get', 'open'], 1], VENUE_OPEN, VENUE_COLOR],
            'circle-radius': ['interpolate', ['linear'], ['zoom'], 6, 4, 10, 5.5, 14, 7],
            'circle-stroke-width': 2,
            'circle-stroke-color': MAP.paperRaised,
          },
        });
        const openVenuePopup = (e: maplibregl.MapLayerMouseEvent) => {
          const f = e.features?.[0];
          if (!f) return;
          new maplibregl.Popup({ offset: 14, className: 'map-popup', maxWidth: '260px' })
            .setLngLat((f.geometry as GeoJSON.Point).coordinates as [number, number])
            .setHTML(venuePopupHtml(f.properties as Record<string, unknown>))
            .addTo(m);
        };
        m.on('click', 'venue-points', openVenuePopup);
        m.on('click', 'venue-clusters', async (e) => {
          const feature = m.queryRenderedFeatures(e.point, { layers: ['venue-clusters'] })[0];
          if (!feature) return;
          const source = m.getSource('venues') as maplibregl.GeoJSONSource;
          const zoom = await source.getClusterExpansionZoom(feature.properties!.cluster_id as number);
          m.easeTo({ center: (feature.geometry as GeoJSON.Point).coordinates as [number, number], zoom, duration: 500 });
        });
        for (const layer of ['venue-points', 'venue-clusters']) {
          m.on('mouseenter', layer, () => (m.getCanvas().style.cursor = 'pointer'));
          m.on('mouseleave', layer, () => (m.getCanvas().style.cursor = ''));
        }

        readyRef.current = true;
        // Props may have changed while the style loaded.
        applyHighlight(m, highlightRef.current);
        applySelected(m, tripRef.current.tripSlugs);
        syncData(m, eventsRef.current, false);
        syncVenues(m, venuesRef.current);
      });
    });
    return () => {
      cancelled = true;
      if (fitTimerRef.current) clearTimeout(fitTimerRef.current);
      fitTimerRef.current = null;
      ro?.disconnect();
      map?.remove();
      mapRef.current = null;
      readyRef.current = false;
      lastSetSigRef.current = null;
      lastStateSigRef.current = null;
      lastVenueSigRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep data in sync with active filters — setData + fitBounds, never re-init.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    syncData(map, events, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    syncVenues(map, venues);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venues]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    applyHighlight(map, highlightSlug);
  }, [highlightSlug]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    applySelected(map, tripSlugs);
  }, [tripSlugs]);

  // Fullscreen map is a deliberate mode switch — one-finger panning is expected.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (fullscreen) map.cooperativeGestures.disable();
    else if (window.matchMedia('(max-width: 899px)').matches) map.cooperativeGestures.enable();
  }, [fullscreen]);

  return <div ref={containerRef} className="map-shell" />;
}

/** Popup = the event-card system, floating on the map. All values escaped. */
function popupHtml(
  p: Record<string, unknown>,
  trip: { active: boolean; selected: boolean },
): string {
  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
  const open = p.state === 'open';
  const isToday = open || p.state === 'today';
  const when =
    (isToday ? 'i dag' : escapeHtml(formatDateLong(String(p.nextDate)))) +
    (p.hours ? ` · ${escapeHtml(String(p.hours))}` : '');
  const free = p.isFree === true || p.isFree === 'true';
  const badges =
    (open ? '<span class="badge open-now"><span class="dot"></span>Åbent nu</span>' : '') +
    `<span class="badge">${escapeHtml(String(p.category))}</span>` +
    (free ? '<span class="badge free">Gratis</span>' : '');
  // In trip mode the popup toggles the stop instead of navigating away.
  const cta = trip.active
    ? `<button type="button" class="map-popup-add" data-slug="${escapeHtml(String(p.slug))}">${trip.selected ? 'Fjern fra turen' : 'Tilføj til turen'}</button>`
    : `<a class="map-card-cta" href="${base}/marked/${encodeURIComponent(String(p.slug))}">Se marked</a>`;
  return (
    `<div class="map-card">` +
    `<h3 class="map-card-title">${escapeHtml(String(p.title))}</h3>` +
    `<div class="map-card-when${isToday ? ' today' : ''}">${when}${p.city ? ` · ${escapeHtml(String(p.city))}` : ''}</div>` +
    `<div class="badge-row">${badges}</div>` +
    cta +
    `</div>`
  );
}

/** Popup for a permanent venue — no date, an opening-hours state + a link out. */
function venuePopupHtml(p: Record<string, unknown>): string {
  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
  const open = p.open === 1 || p.open === '1';
  const badges =
    (open ? '<span class="badge open-now"><span class="dot"></span>Åbent nu</span>' : '') +
    `<span class="badge venue-badge">${escapeHtml(String(p.vtype))}</span>`;
  return (
    `<div class="map-card">` +
    `<h3 class="map-card-title">${escapeHtml(String(p.title))}</h3>` +
    `<div class="map-card-when">${p.city ? escapeHtml(String(p.city)) : 'Fast butik'}</div>` +
    `<div class="badge-row">${badges}</div>` +
    `<a class="map-card-cta" href="${base}/sted/${encodeURIComponent(String(p.slug))}">Se butik</a>` +
    `</div>`
  );
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
