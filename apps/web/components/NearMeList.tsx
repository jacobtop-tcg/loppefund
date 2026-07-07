'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { EventSummary } from '../lib/data.ts';
import { EventCard } from './EventCard.tsx';
import { copenhagenToday, distanceKm } from '../lib/client-utils.ts';
import { readSavedLocation, writeSavedLocation } from '../lib/saved-location.ts';

const SHOWN = 12;

/**
 * The market list for the /naer-mig intent landing page ("loppemarked i
 * nærheden"). A client island: the static HTML carries the ask-for-location
 * state (plus the crawlable city fallback rendered by the server page), and
 * after mount the device-local saved location — written here or by the map's
 * "Nær mig" — restores the distance-sorted list without a second permission
 * tap. Location never leaves the device: localStorage only, never a URL.
 */
export function NearMeList({
  events,
  buildToday,
}: {
  events: EventSummary[];
  buildToday: string;
}) {
  // Seed from the build date so the first client render matches the server
  // HTML (no hydration mismatch), then correct to the live Copenhagen date.
  const [today, setToday] = useState(buildToday);
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);

  useEffect(() => {
    const live = copenhagenToday();
    setToday((prev) => (live !== prev ? live : prev));
    const saved = readSavedLocation();
    if (saved) setPos({ lat: saved.lat, lng: saved.lng });
  }, []);

  const locate = () => {
    if (!navigator.geolocation) {
      setGeoError('Din browser deler ikke placering — find din by nedenfor i stedet.');
      return;
    }
    setLocating(true);
    setGeoError(null);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        const next = { lat: p.coords.latitude, lng: p.coords.longitude };
        setPos(next);
        setLocating(false);
        setGeoError(null);
        // Remember it (coarsened, device-only) and keep any radius the visitor
        // already picked on the map — this page only refreshes the coordinates.
        writeSavedLocation({ ...next, radius: readSavedLocation()?.radius ?? null });
      },
      () => {
        setLocating(false);
        setGeoError('Kunne ikke hente din placering — tjek tilladelser, eller find din by nedenfor.');
      },
      { timeout: 8000 },
    );
  };

  if (!pos) {
    return (
      <div className="nearme-ask">
        <button type="button" className="nearme-btn" onClick={locate} disabled={locating}>
          {locating ? 'Finder dig…' : 'Brug min placering'}
        </button>
        <p className="nearme-privacy">
          Din placering bruges kun til at sortere listen — den gemmes kun på din egen enhed og
          sendes aldrig til os.
        </p>
        {geoError && (
          <p className="geo-error" role="alert">
            {geoError}
          </p>
        )}
      </div>
    );
  }

  const nearest = events
    .map((e) => {
      const next = e.occurrences.find((o) => o.date >= today);
      return e.lat != null && e.lng != null && next
        ? { event: e, nextDate: next.date, km: distanceKm(pos.lat, pos.lng, e.lat, e.lng) }
        : null;
    })
    .filter((x): x is { event: EventSummary; nextDate: string; km: number } => x !== null)
    .sort((a, b) => a.km - b.km)
    .slice(0, SHOWN);

  if (nearest.length === 0) {
    return (
      <div className="empty-state">
        <p>
          Ingen kommende markeder med kendt adresse lige nu. Nye markeder kommer til hele tiden —
          kig forbi igen.
        </p>
        <Link href="/byer" className="empty-cta">
          Find din by i stedet →
        </Link>
      </div>
    );
  }

  const noun = nearest.length === 1 ? 'marked' : 'markeder';
  return (
    <>
      <div className="result-head" style={{ margin: '8px 0 2px' }}>
        <p className="result-lead">Nærmest dig først</p>
        <p className="result-count" aria-live="polite">
          <strong>{nearest.length}</strong> {noun}
        </p>
      </div>
      <div className="event-grid" style={{ marginTop: 14 }}>
        {nearest.map(({ event, nextDate, km }, i) => (
          <EventCard
            key={event.slug}
            event={{ ...event, nextDate, distanceKm: km }}
            today={today}
            index={i}
          />
        ))}
      </div>
      <p className="nearme-after">
        <Link href="/">Se dem på kortet →</Link>
        <button type="button" className="nearme-relocate" onClick={locate} disabled={locating}>
          {locating ? 'Finder dig…' : 'Opdatér min placering'}
        </button>
      </p>
      {geoError && (
        <p className="geo-error" role="alert">
          {geoError}
        </p>
      )}
    </>
  );
}
