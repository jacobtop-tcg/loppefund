import { describe, expect, it } from 'vitest';
import { buildTripUrl } from './client-utils.ts';

describe('buildTripUrl', () => {
  it('returns null below 2 stops', () => {
    expect(buildTripUrl([])).toBeNull();
    expect(buildTripUrl([{ lat: 55.6761, lng: 12.5683 }])).toBeNull();
  });

  it('routes through waypoints to the last stop as destination', () => {
    const url = buildTripUrl([
      { lat: 55.6761, lng: 12.5683 },
      { lat: 56.1629, lng: 10.2039 },
    ])!;
    const p = new URL(url).searchParams;
    expect(p.get('api')).toBe('1');
    expect(p.get('travelmode')).toBe('driving');
    expect(p.get('destination')).toBe('56.162900,10.203900');
    expect(p.get('waypoints')).toBe('55.676100,12.568300');
  });

  it('joins multiple waypoints with | in route order', () => {
    const url = buildTripUrl([
      { lat: 55.1, lng: 12.1 },
      { lat: 55.2, lng: 12.2 },
      { lat: 55.3, lng: 12.3 },
    ])!;
    expect(new URL(url).searchParams.get('waypoints')).toBe(
      '55.100000,12.100000|55.200000,12.200000',
    );
    expect(url).toContain('%7C');
  });
});
