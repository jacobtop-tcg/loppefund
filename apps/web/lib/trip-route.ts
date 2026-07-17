/** Pure helpers for rendering a loppetur route on the map (no maplibre import,
 *  so it's unit-testable in the node env). */

export type RouteStop = { id: string; lat: number; lng: number };

export const EMPTY_FC: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

/** A LineString through the ordered stops + a numbered Point per stop. */
export function toRouteGeoJson(route: RouteStop[]): {
  line: GeoJSON.FeatureCollection;
  stops: GeoJSON.FeatureCollection;
} {
  const coords = route.map((s) => [s.lng, s.lat] as [number, number]);
  return {
    line:
      coords.length >= 2
        ? {
            type: 'FeatureCollection',
            features: [
              { type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} },
            ],
          }
        : EMPTY_FC,
    stops: {
      type: 'FeatureCollection',
      features: route.map((s, i) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [s.lng, s.lat] },
        // The id travels with the badge so tapping it can remove that stop. The
        // badge used to carry only its number, which made it a label rather than
        // a control — and left a stop that had fallen out of the filtered list
        // unremovable except by clearing the whole trip.
        properties: { n: String(i + 1), id: s.id },
      })),
    },
  };
}
