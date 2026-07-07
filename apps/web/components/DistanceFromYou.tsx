'use client';

import { useEffect, useState } from 'react';
import { distanceKm } from '../lib/client-utils.ts';
import { readSavedLocation } from '../lib/saved-location.ts';

/**
 * "ca. 13 km fra dig" on detail pages — the first question after "hvornår?"
 * for a visitor landing straight from Google. Renders ONLY when the device
 * already holds a saved location (shared earlier on the map or /naer-mig):
 * no permission prompt, nothing at all for visitors who never opted in, and
 * the location itself never leaves the device. Server and first client render
 * agree on null, so hydration stays clean.
 */
export function DistanceFromYou({ lat, lng }: { lat: number; lng: number }) {
  const [km, setKm] = useState<number | null>(null);
  useEffect(() => {
    const saved = readSavedLocation();
    if (saved) setKm(distanceKm(saved.lat, saved.lng, lat, lng));
  }, [lat, lng]);
  if (km === null) return null;
  return (
    <span className="detail-distance">
      {' · '}
      {km < 1 ? 'under 1 km fra dig' : `ca. ${Math.round(km)} km fra dig`}
    </span>
  );
}
