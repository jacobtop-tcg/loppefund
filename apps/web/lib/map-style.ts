/**
 * Shared MapLibre base style for the explorer and detail maps.
 *
 * Strategy: fetch OpenFreeMap's positron style (free vector tiles, no API key,
 * ~25 KB JSON) at runtime and re-theme it in place to the warm-paper design
 * tokens — we never ship a custom style file. Falls back to the previous
 * raster-OSM style if OpenFreeMap is unreachable.
 */
import type { LayerSpecification, StyleSpecification } from 'maplibre-gl';

const STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';
const SESSION_KEY = 'loppefund:ofm-positron:v1';
const FETCH_TIMEOUT_MS = 5000;

/** Design tokens mirrored from globals.css :root — WebGL paint can't read CSS variables. */
export const MAP = {
  paper: '#faf5ec',
  paperRaised: '#fffdf8',
  ink: '#241f19',
  inkSoft: '#6b6157',
  inkFaint: '#a2988c',
  line: '#e4dbc9',
  accent: '#e4572e',
  accentDeep: '#c73e18',
  green: '#3e7a4e',
} as const;

export interface LoadedMapStyle {
  style: StyleSpecification;
  /** false = raster fallback (OpenFreeMap unreachable). */
  vector: boolean;
  /** Font stacks valid for the loaded glyph endpoint. */
  fonts: { regular: string[]; bold: string[] };
}

// OpenFreeMap hosts Noto Sans Regular/Bold/Italic; the demotiles fallback
// endpoint is only known-good for Noto Sans Regular (what ships today).
const VECTOR_FONTS = { regular: ['Noto Sans Regular'], bold: ['Noto Sans Bold'] };
const RASTER_FONTS = { regular: ['Noto Sans Regular'], bold: ['Noto Sans Regular'] };

/** Zero-clutter: drop layer classes we never want (positron has an `airport` symbol layer today; poi/housenumber are a safety net if OFM adds them). */
const HIDE = /poi|housenumber|airport|aerodrome|ferry/;

/**
 * Exact paint overrides per positron layer id (ids verified against the live
 * style JSON). Values merge over the original paint, so zoom-driven opacity
 * and width ramps are preserved — we only replace colors.
 */
const LAYER_PAINT: Record<string, Record<string, unknown>> = {
  // land
  background: { 'background-color': MAP.paper },
  park: { 'fill-color': '#e4eeda' },
  landcover_wood: { 'fill-color': '#d9e6d2' },
  landcover_ice_shelf: { 'fill-color': '#f4f1e8' },
  landcover_glacier: { 'fill-color': '#f4f1e8' },
  landuse_residential: { 'fill-color': '#f1ead9' }, // --paper-sunken
  building: { 'fill-color': '#eee5d3', 'fill-outline-color': MAP.line },
  // water — muted sea-glass that harmonises with warm paper
  water: { 'fill-color': '#c9dbe1' },
  waterway: { 'line-color': '#b9d0d9' },
  // roads: warm-white ribbons with --line casings
  highway_path: { 'line-color': '#e6ddc9' },
  highway_minor: { 'line-color': '#f8f3e7' },
  highway_major_casing: { 'line-color': MAP.line },
  highway_major_inner: { 'line-color': MAP.paperRaised },
  highway_major_subtle: { 'line-color': 'rgba(228, 219, 201, 0.7)' },
  highway_motorway_casing: { 'line-color': '#ddd0b6' },
  highway_motorway_inner: {
    // keep positron's z5.8→6 fade-in, re-hued
    'line-color': ['interpolate', ['linear'], ['zoom'], 5.8, 'rgba(228, 219, 201, 0.5)', 6, MAP.paperRaised],
  },
  highway_motorway_subtle: { 'line-color': 'rgba(228, 219, 201, 0.55)' },
  highway_motorway_bridge_casing: { 'line-color': '#ddd0b6' },
  highway_motorway_bridge_inner: { 'line-color': MAP.paperRaised },
  tunnel_motorway_casing: { 'line-color': '#ece4d2' },
  tunnel_motorway_inner: { 'line-color': '#f8f3e8' },
  road_area_pier: { 'fill-color': '#efe8d8' },
  road_pier: { 'line-color': '#efe8d8' },
  // rail + aeroways: quiet warm greys
  railway: { 'line-color': '#ded3bf' },
  railway_dashline: { 'line-color': '#f4eee0' },
  railway_transit: { 'line-color': '#ded3bf' },
  railway_transit_dashline: { 'line-color': '#f4eee0' },
  railway_service: { 'line-color': '#ded3bf' },
  railway_service_dashline: { 'line-color': '#f4eee0' },
  'aeroway-area': { 'fill-color': '#eae1cf' },
  'aeroway-taxiway': { 'line-color': '#eae1cf' },
  'aeroway-runway': { 'line-color': '#eae1cf' },
  'aeroway-runway-casing': { 'line-color': '#e0d6c2' },
  // boundaries
  boundary_2: { 'line-color': '#c9bda6' },
  boundary_3: { 'line-color': '#c9bda6' },
  boundary_disputed: { 'line-color': '#c9bda6' },
  // labels — muted ink scale, paper halos
  waterway_line_label: { 'text-color': '#6f8e9c', 'text-halo-color': 'rgba(250, 245, 236, 0.8)' },
  water_name_point_label: { 'text-color': '#6f8e9c', 'text-halo-color': 'rgba(250, 245, 236, 0.8)' },
  water_name_line_label: { 'text-color': '#6f8e9c', 'text-halo-color': 'rgba(250, 245, 236, 0.8)' },
  'highway-name-path': { 'text-color': '#8d8274', 'text-halo-color': MAP.paper },
  'highway-name-minor': { 'text-color': '#8d8274', 'text-halo-color': MAP.paper },
  'highway-name-major': { 'text-color': '#8d8274', 'text-halo-color': MAP.paper },
  label_other: { 'text-color': '#8d8274', 'text-halo-color': MAP.paper },
  label_village: { 'text-color': '#5f564b', 'text-halo-color': MAP.paper },
  label_town: { 'text-color': '#4a423a', 'text-halo-color': MAP.paper },
  label_state: { 'text-color': MAP.inkFaint, 'text-halo-color': MAP.paper },
  label_city: { 'text-color': '#3d362e', 'text-halo-color': MAP.paper },
  label_city_capital: { 'text-color': MAP.ink, 'text-halo-color': MAP.paper },
  label_country_3: { 'text-color': MAP.inkSoft, 'text-halo-color': MAP.paper },
  label_country_2: { 'text-color': MAP.inkSoft, 'text-halo-color': MAP.paper },
  label_country_1: { 'text-color': MAP.inkSoft, 'text-halo-color': MAP.paper },
};

// Safety net: if OpenFreeMap renames/adds symbol layers, they still land in
// the warm ink scale instead of positron's cold greys.
const SYMBOL_DEFAULT = { 'text-color': MAP.inkSoft, 'text-halo-color': MAP.paper };

function retheme(input: StyleSpecification): StyleSpecification {
  const style = structuredClone(input);
  style.layers = style.layers.filter((l) => !HIDE.test(l.id));
  for (const layer of style.layers) {
    const override = LAYER_PAINT[layer.id] ?? (layer.type === 'symbol' ? SYMBOL_DEFAULT : undefined);
    if (!override) continue;
    const l = layer as LayerSpecification & { paint?: Record<string, unknown> };
    l.paint = { ...l.paint, ...override };
  }
  return style;
}

/** The pre-vector style, kept verbatim as graceful degradation. */
const RASTER_FALLBACK: StyleSpecification = {
  version: 8,
  // Required for symbol layers (cluster counts, date labels).
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

function readSession(): StyleSpecification | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? (JSON.parse(raw) as StyleSpecification) : null;
  } catch {
    return null;
  }
}

function writeSession(style: StyleSpecification): void {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(style));
  } catch {
    // Quota/private mode — the module-level cache still covers this page load.
  }
}

function clearSession(): void {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // Private mode — nothing to clear.
  }
}

interface RawStyle {
  raw: StyleSpecification | null; // null => use the raster fallback
  vector: boolean;
  fonts: { regular: string[]; bold: string[] };
}

let rawPending: Promise<RawStyle> | null = null;

/**
 * One style FETCH per page load, but a FRESH re-themed style object per call.
 *
 * maplibre mutates the style object it is handed while loading it (sources and
 * layers are transformed in place), so two map instances must never share one
 * object — the second would receive a half-consumed style and silently stall
 * with a blank canvas. We therefore cache only the raw fetch and clone it
 * (retheme runs structuredClone) on every call.
 */
export function loadMapStyle(): Promise<LoadedMapStyle> {
  rawPending ??= loadRaw();
  return rawPending.then(({ raw, vector, fonts }) => {
    if (raw) {
      try {
        return { style: retheme(raw), vector, fonts };
      } catch {
        clearSession(); // corrupt cached raw — drop it and use the raster base
      }
    }
    return { style: structuredClone(RASTER_FALLBACK), vector: raw ? vector : false, fonts: raw ? fonts : RASTER_FONTS };
  });
}

async function loadRaw(): Promise<RawStyle> {
  const cached = readSession();
  if (cached) return { raw: cached, vector: true, fonts: VECTOR_FONTS };
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    const res = await fetch(STYLE_URL, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`style ${res.status}`);
    const raw = (await res.json()) as StyleSpecification;
    retheme(raw); // validate the shape before caching (throws => fall back)
    writeSession(raw); // cache the RAW style so retheme tweaks apply without cache-busting
    return { raw, vector: true, fonts: VECTOR_FONTS };
  } catch {
    rawPending = null; // a later map mount retries OpenFreeMap
    return { raw: null, vector: false, fonts: RASTER_FONTS };
  }
}
