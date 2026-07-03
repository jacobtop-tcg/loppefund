'use client';

import { memo, useCallback, useRef } from 'react';

export type DateFilter = 'aabent-nu' | 'idag' | 'imorgen' | 'weekend' | 'naeste-weekend' | 'alle';

const DATE_CHIPS: Array<{ key: DateFilter; label: string }> = [
  { key: 'aabent-nu', label: 'Åbent nu' },
  { key: 'idag', label: 'I dag' },
  { key: 'imorgen', label: 'I morgen' },
  { key: 'weekend', label: 'I weekenden' },
  { key: 'naeste-weekend', label: 'Næste weekend' },
  { key: 'alle', label: 'Alle datoer' },
];

const CATEGORY_CHIPS: Array<{ key: string; label: string }> = [
  { key: 'loppemarked', label: 'Loppemarked' },
  { key: 'kraemmermarked', label: 'Kræmmer' },
  { key: 'bagagerumsmarked', label: 'Bagagerum' },
  { key: 'antikmarked', label: 'Antik' },
];

const RADIUS_CHIPS = [10, 25, 50] as const;

/**
 * The slim sticky bar: search + one scrollable chip line (dates | location |
 * saved + trip) with the secondary filters folded into a CSS-only popover.
 * Memoized — Explorer re-renders on every card hover (hoveredSlug) and this
 * bar receives only stable props.
 */
export const FilterBar = memo(function FilterBar(props: {
  query: string;
  onQuery: (v: string) => void;
  dateFilter: DateFilter;
  onDateFilter: (v: DateFilter) => void;
  category: string | null;
  onCategory: (v: string | null) => void;
  freeOnly: boolean;
  onFreeOnly: (v: boolean) => void;
  familyOnly: boolean;
  onFamilyOnly: (v: boolean) => void;
  inOut: 'indoor' | 'outdoor' | null;
  onInOut: (v: 'indoor' | 'outdoor' | null) => void;
  savedOnly: boolean;
  onSavedOnly: (v: boolean) => void;
  favCount: number;
  pos: { lat: number; lng: number } | null;
  locating: boolean;
  onLocate: () => void;
  onClearPos: () => void;
  geoError: string | null;
  radius: number | null;
  onRadius: (v: number | null) => void;
  tripMode: boolean;
  onToggleTripMode: () => void;
}) {
  const popRef = useRef<HTMLDetailsElement>(null);
  const summaryRef = useRef<HTMLElement>(null);

  // Escape closes the Filtre popover and returns focus to its summary.
  const onPopKeyDown = useCallback((e: React.KeyboardEvent<HTMLDetailsElement>) => {
    if (e.key === 'Escape' && popRef.current?.open) {
      popRef.current.open = false;
      summaryRef.current?.focus();
    }
  }, []);

  const secondaryCount =
    (props.category ? 1 : 0) +
    (props.freeOnly ? 1 : 0) +
    (props.familyOnly ? 1 : 0) +
    (props.inOut ? 1 : 0);

  return (
    <div className="controls">
      <div className="search-row">
        <label className="search-box">
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            type="search"
            placeholder="Søg marked, by eller sted…"
            value={props.query}
            onChange={(e) => props.onQuery(e.target.value)}
            aria-label="Søg"
          />
        </label>
        <details className="filter-pop" ref={popRef} onKeyDown={onPopKeyDown}>
          <summary ref={summaryRef} className={`chip${secondaryCount > 0 ? ' has-active' : ''}`}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden>
              <path d="M4 6h16M7 12h10M10 18h4" />
            </svg>
            Filtre
            {secondaryCount > 0 && <span className="count-dot">{secondaryCount}</span>}
          </summary>
          <div className="filter-panel">
            <div className="filter-group">
              <div className="filter-group-label">Type</div>
              <div className="chips">
                {CATEGORY_CHIPS.map((c) => (
                  <button
                    key={c.key}
                    className={`chip ${props.category === c.key ? 'active' : ''}`}
                    aria-pressed={props.category === c.key}
                    onClick={() => props.onCategory(props.category === c.key ? null : c.key)}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="filter-group">
              <div className="filter-group-label">Praktisk</div>
              <div className="chips">
                <button
                  className={`chip ${props.freeOnly ? 'active' : ''}`}
                  aria-pressed={props.freeOnly}
                  onClick={() => props.onFreeOnly(!props.freeOnly)}
                >
                  Gratis entré
                </button>
                <button
                  className={`chip ${props.familyOnly ? 'active' : ''}`}
                  aria-pressed={props.familyOnly}
                  onClick={() => props.onFamilyOnly(!props.familyOnly)}
                >
                  Børnevenligt
                </button>
                <button
                  className={`chip ${props.inOut === 'indoor' ? 'active' : ''}`}
                  aria-pressed={props.inOut === 'indoor'}
                  onClick={() => props.onInOut(props.inOut === 'indoor' ? null : 'indoor')}
                >
                  Indendørs
                </button>
                <button
                  className={`chip ${props.inOut === 'outdoor' ? 'active' : ''}`}
                  aria-pressed={props.inOut === 'outdoor'}
                  onClick={() => props.onInOut(props.inOut === 'outdoor' ? null : 'outdoor')}
                >
                  Udendørs
                </button>
              </div>
            </div>
          </div>
        </details>
      </div>
      <div className="chip-row">
        {DATE_CHIPS.map((c) => (
          <button
            key={c.key}
            className={`chip ${props.dateFilter === c.key ? 'active' : ''}`}
            aria-pressed={props.dateFilter === c.key}
            onClick={() => props.onDateFilter(c.key)}
          >
            {c.key === 'aabent-nu' && <span className="live-dot" aria-hidden />}
            {c.label}
          </button>
        ))}
        <span className="chip-sep" aria-hidden />
        <button
          className={`chip accent ${props.pos ? 'active' : ''}`}
          aria-pressed={props.pos !== null}
          onClick={() => (props.pos ? props.onClearPos() : props.onLocate())}
        >
          {props.locating ? 'Finder dig…' : props.pos ? '✓ Nær mig' : '◎ Nær mig'}
        </button>
        {props.geoError && !props.pos && (
          <span role="status" style={{ fontSize: '0.8rem', color: 'var(--ink-faint)', alignSelf: 'center' }}>
            {props.geoError}
          </span>
        )}
        {props.pos &&
          RADIUS_CHIPS.map((r) => (
            <button
              key={r}
              className={`chip ${props.radius === r ? 'active' : ''}`}
              aria-pressed={props.radius === r}
              onClick={() => props.onRadius(props.radius === r ? null : r)}
            >
              {r} km
            </button>
          ))}
        <span className="chip-sep" aria-hidden />
        {props.favCount > 0 && (
          <button
            className={`chip accent ${props.savedOnly ? 'active' : ''}`}
            aria-pressed={props.savedOnly}
            onClick={() => props.onSavedOnly(!props.savedOnly)}
          >
            ♥ Gemte ({props.favCount})
          </button>
        )}
        <button
          className={`chip accent ${props.tripMode ? 'active' : ''}`}
          aria-pressed={props.tripMode}
          onClick={props.onToggleTripMode}
        >
          {props.tripMode ? '✓ Loppetur' : 'Lav en loppetur'}
        </button>
      </div>
    </div>
  );
});
