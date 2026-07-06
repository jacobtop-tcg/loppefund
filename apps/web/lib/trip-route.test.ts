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
