import { describe, expect, it } from 'vitest';
import { toRouteGeoJson } from './trip-route.ts';

describe('toRouteGeoJson', () => {
  it('builds a LineString through the ordered stops and a numbered point each', () => {
    const { line, stops } = toRouteGeoJson([
      { id: 'e:a', lat: 55.7, lng: 12.5 },
      { id: 'v:b', lat: 56.1, lng: 10.2 },
      { id: 'e:c', lat: 55.4, lng: 11.8 },
    ]);
    expect(line.features).toHaveLength(1);
    const geom = line.features[0]!.geometry as GeoJSON.LineString;
    expect(geom.type).toBe('LineString');
    expect(geom.coordinates).toEqual([
      [12.5, 55.7],
      [10.2, 56.1],
      [11.8, 55.4],
    ]);
    expect(stops.features.map((f) => f.properties!.n)).toEqual(['1', '2', '3']);
    expect((stops.features[0]!.geometry as GeoJSON.Point).coordinates).toEqual([12.5, 55.7]);
  });

  it('omits the line for a single stop but still numbers it', () => {
    const { line, stops } = toRouteGeoJson([{ id: 'e:solo', lat: 55, lng: 10 }]);
    expect(line.features).toHaveLength(0);
    expect(stops.features).toHaveLength(1);
    expect(stops.features[0]!.properties!.n).toBe('1');
  });

  it('is empty for an empty route', () => {
    const { line, stops } = toRouteGeoJson([]);
    expect(line.features).toHaveLength(0);
    expect(stops.features).toHaveLength(0);
  });
});

describe('a badge is a control, not a label', () => {
  // The badges render from tripRoute, not from the filtered list, so they are
  // the only surface that always shows EVERY stop — including one stranded
  // outside the current date chip. That made them the natural place to remove
  // such a stop, and they couldn't be: they carried the number and nothing else,
  // so a click handler would have had no way to know which stop was tapped.
  it('carries the stop id, so tapping it can identify what to drop', () => {
    const { stops } = toRouteGeoJson([
      { id: 'e:absalon', lat: 55.7, lng: 12.5 },
      { id: 'v:mission-afrika', lat: 55.4, lng: 8.4 },
    ]);
    expect(stops.features.map((f) => f.properties)).toEqual([
      { n: '1', id: 'e:absalon' },
      { n: '2', id: 'v:mission-afrika' },
    ]);
  });

  it('keeps the id namespaced, so events and venues stay distinguishable', () => {
    const { stops } = toRouteGeoJson([{ id: 'v:x', lat: 55, lng: 12 }]);
    // The id IS the trip slug — handing it straight back to toggleTrip is what
    // makes the badge a remove button with no extra lookup.
    expect(stops.features[0]!.properties!.id).toBe('v:x');
  });
});
