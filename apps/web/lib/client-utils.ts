/** Small pure helpers safe for client bundles. */

export function addDaysIso(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return date.toISOString().slice(0, 10);
}

/** Danish-aware fold for instant search: lowercase, ø->o, å->a, æ->ae. */
export function foldForSearch(text: string): string {
  return text
    .toLowerCase()
    .replaceAll('æ', 'ae')
    .replaceAll('ø', 'o')
    .replaceAll('å', 'a')
    .replaceAll('oe', 'o')
    .replaceAll('aa', 'a');
}

export interface TripStop {
  lat: number;
  lng: number;
}

/** Google Maps URL API limit: 9 waypoints + destination. */
export const MAX_TRIP_STOPS = 10;

/**
 * Directions URL from the user's current location through stops in order;
 * the last stop is the destination. Returns null for fewer than 2 stops.
 * Omitting `origin` makes Google start from the user's current position.
 */
export function buildTripUrl(stops: ReadonlyArray<TripStop>): string | null {
  if (stops.length < 2) return null;
  const fmt = (s: TripStop) => `${s.lat.toFixed(6)},${s.lng.toFixed(6)}`;
  const params = new URLSearchParams({
    api: '1',
    destination: fmt(stops[stops.length - 1]!),
    travelmode: 'driving',
  });
  params.set('waypoints', stops.slice(0, -1).map(fmt).join('|'));
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

export function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
