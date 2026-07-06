// Shown while the MapLibre bundle + tiles load. Replaces a dead grey "loading"
// line with a warm, on-brand placeholder: a faint cartographic motif (roads,
// coastline, a hint of water) under a soft shimmer sweep, with a gently
// dropping map pin. Pure CSS/SVG, no JS — it costs nothing and makes the
// biggest empty moment in the app feel intentional instead of broken.
export function MapSkeleton({ className = '', label = 'Tegner kortet…' }: { className?: string; label?: string }) {
  return (
    <div className={`map-skeleton ${className}`.trim()} role="status" aria-label="Kortet indlæses">
      <svg className="map-skeleton-motif" viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice" aria-hidden>
        {/* a soft bay of water in one corner */}
        <path d="M400 0 L400 130 Q300 150 250 110 Q200 70 260 30 Q300 0 400 0 Z" className="ms-water" />
        {/* coastline + a couple of arterial roads, abstract not literal */}
        <path d="M250 110 Q200 70 260 30" className="ms-coast" />
        <path d="M-10 90 Q120 70 210 150 Q290 220 420 190" className="ms-road ms-road-major" />
        <path d="M40 -10 Q70 120 30 320" className="ms-road" />
        <path d="M120 320 Q150 200 210 150" className="ms-road" />
        <path d="M210 150 Q250 130 300 200 Q330 250 320 320" className="ms-road" />
        <path d="M-10 230 Q100 210 210 150" className="ms-road" />
      </svg>
      <div className="map-skeleton-shimmer" aria-hidden />
      <div className="map-skeleton-center">
        <svg className="map-skeleton-pin" viewBox="0 0 24 24" width="30" height="30" aria-hidden>
          <path
            d="M12 2c-3.9 0-7 3-7 6.8 0 4.6 5.1 10.4 6.5 11.9a.7.7 0 0 0 1 0C13.9 19.2 19 13.4 19 8.8 19 5 15.9 2 12 2Z"
            fill="currentColor"
          />
          <circle cx="12" cy="8.8" r="2.6" fill="var(--paper-raised)" />
        </svg>
        <span className="map-skeleton-label">{label}</span>
      </div>
    </div>
  );
}
