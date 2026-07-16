'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  EMPTY_INFORMAL_FILTER,
  activeFilterCount,
  filterInformalPlaces,
  regionOptions,
  signalOptions,
  sortWithinLayers,
  typeOptions,
  type InformalFilterState,
  type InformalSort,
  type TextMatcher,
  type InventorySignal,
  type InformalPlaceType,
} from '@loppefund/core';
import type { InformalPlaceSummary } from '../lib/informal.ts';
import { foldForSearch, matchesQuery } from '../lib/client-utils.ts';
import {
  PLACE_TYPE_LABELS,
  SIGNAL_LABELS,
  STATUS_LABELS,
  TRUST_LAYER_LABELS,
} from '../lib/informal-labels.ts';

/**
 * Filter + browse for hidden places.
 *
 * The three trust layers stay three SEPARATE sections no matter what is
 * filtered or sorted — that is enforced upstream by sortWithinLayers(), which
 * never hands back a flat ranked list. Filters here only ever narrow.
 *
 * Every option offered is derived from the places actually present, so a chip
 * can never promise inventory we don't have.
 */

const HIGH_FUND = 70;

/** Pair the two Danish folds correctly: the blob is indexed with searchFold()
 *  (both spellings), the query is collapsed with foldForSearch() (lazy one). */
const matchText: TextMatcher = (hay, q) => matchesQuery(hay, foldForSearch(q));

export default function HiddenPlaces({ places }: { places: InformalPlaceSummary[] }) {
  const [f, setF] = useState<InformalFilterState>(EMPTY_INFORMAL_FILTER);
  const [sort, setSort] = useState<InformalSort>('fund');

  const set = <K extends keyof InformalFilterState>(k: K, v: InformalFilterState[K]) =>
    setF((prev) => ({ ...prev, [k]: v }));

  const toggle = <T,>(list: T[], v: T): T[] =>
    list.includes(v) ? list.filter((x) => x !== v) : [...list, v];

  const signals = useMemo(() => signalOptions(places), [places]);
  const types = useMemo(() => typeOptions(places), [places]);
  const regions = useMemo(() => regionOptions(places), [places]);

  const sections = useMemo(
    () => sortWithinLayers(filterInformalPlaces(places, f, matchText), sort),
    [places, f, sort],
  );
  const shown = sections.reduce((n, s) => n + s.places.length, 0);
  const active = activeFilterCount(f);

  return (
    <>
      <div className="ip-filters panel">
        <label className="search-field">
          <span className="sr-only">Søg blandt skjulte steder</span>
          <input
            type="search"
            value={f.query}
            onChange={(e) => set('query', e.target.value)}
            placeholder="Søg — sted, by eller kommune"
            className="search-box"
          />
        </label>

        {signals.length > 0 && (
          <fieldset className="ip-fieldset">
            <legend className="ip-legend">Hvad leder du efter?</legend>
            <div className="chip-row">
              {signals.map((s: InventorySignal) => (
                <button
                  key={s}
                  type="button"
                  className={`chip${f.signals.includes(s) ? ' active' : ''}`}
                  aria-pressed={f.signals.includes(s)}
                  onClick={() => set('signals', toggle(f.signals, s))}
                >
                  {SIGNAL_LABELS[s]}
                </button>
              ))}
            </div>
          </fieldset>
        )}

        {types.length > 1 && (
          <fieldset className="ip-fieldset">
            <legend className="ip-legend">Type sted</legend>
            <div className="chip-row">
              {types.map((t: InformalPlaceType) => (
                <button
                  key={t}
                  type="button"
                  className={`chip${f.types.includes(t) ? ' active' : ''}`}
                  aria-pressed={f.types.includes(t)}
                  onClick={() => set('types', toggle(f.types, t))}
                >
                  {PLACE_TYPE_LABELS[t]}
                </button>
              ))}
            </div>
          </fieldset>
        )}

        <div className="ip-selects">
          {regions.length > 1 && (
            <label className="ip-select">
              Kommune
              <select
                value={f.region ?? ''}
                onChange={(e) => set('region', e.target.value || null)}
              >
                <option value="">Hele landet</option>
                {regions.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="ip-select">
            Sortér
            <select value={sort} onChange={(e) => setSort(e.target.value as InformalSort)}>
              <option value="fund">Bedste fundchance</option>
              <option value="sikkerhed">Mest sikre</option>
              <option value="senest">Senest set</option>
            </select>
          </label>
        </div>

        <div className="chip-row ip-toggles">
          <button
            type="button"
            className={`chip${f.layers.length > 0 ? ' active' : ''}`}
            aria-pressed={f.layers.length > 0}
            onClick={() =>
              set('layers', f.layers.length > 0 ? [] : ['bekraeftet', 'kontroller-foerst'])
            }
          >
            Skjul ubekræftede spor
          </button>
          <button
            type="button"
            className={`chip${f.hideCallFirst ? ' active' : ''}`}
            aria-pressed={f.hideCallFirst}
            onClick={() => set('hideCallFirst', !f.hideCallFirst)}
          >
            Kan besøges uden opkald
          </button>
          <button
            type="button"
            className={`chip${f.minFund > 0 ? ' active' : ''}`}
            aria-pressed={f.minFund > 0}
            onClick={() => set('minFund', f.minFund > 0 ? 0 : HIGH_FUND)}
          >
            Høj fundchance
          </button>
          {active > 0 && (
            <button type="button" className="chip chip-clear" onClick={() => setF(EMPTY_INFORMAL_FILTER)}>
              Ryd {active} filter{active === 1 ? '' : 'e'}
            </button>
          )}
        </div>
      </div>

      <p className="ip-count" aria-live="polite">
        {shown === places.length
          ? `${places.length} skjulte steder`
          : `${shown} af ${places.length} skjulte steder`}
      </p>

      {shown === 0 ? (
        <div className="empty-state">
          <p>
            Ingen skjulte steder passer på det. Prøv at fjerne et filter — eller tip os om et sted,
            du selv kender.
          </p>
          <Link href="/tip-perle" className="empty-cta">
            Tip en skjult perle →
          </Link>
        </div>
      ) : (
        sections.map(({ layer, places: list }) => {
          if (list.length === 0) return null;
          const meta = TRUST_LAYER_LABELS[layer];
          return (
            <section key={layer} className={`ip-section ip-section-${layer}`}>
              <h2 className="ip-section-title">{meta.title}</h2>
              <p className="ip-section-body">{meta.body}</p>
              <div className="event-grid">
                {list.map((p) => (
                  <Link key={p.slug} href={`/perle/${p.slug}`} className="ip-card">
                    <div className="ip-card-head">
                      <span className="ip-card-type">{PLACE_TYPE_LABELS[p.placeType]}</span>
                      <span className={`ip-card-fund ip-fund-${p.fundScore >= HIGH_FUND ? 'high' : 'mid'}`}>
                        {p.fundScore}
                        <span className="ip-card-fund-unit">/100 fund</span>
                      </span>
                    </div>
                    <h3 className="ip-card-name">{p.name}</h3>
                    <div className="ip-card-where">
                      {p.city ?? 'Sted ukendt'}
                      {p.areaOnly && <span className="ip-card-area"> · ca. område</span>}
                    </div>
                    {p.inventorySignals.length > 0 && (
                      <div className="ip-card-signals">
                        {p.inventorySignals.slice(0, 4).map((s) => (
                          <span key={s} className="ip-signal">
                            {SIGNAL_LABELS[s]}
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="ip-card-meta">
                      <span>{STATUS_LABELS[p.status]}</span>
                      <span className="ip-card-conf">{p.confidence}/100 sikkerhed</span>
                    </div>
                    {p.callBeforeVisiting && <div className="ip-card-warn">Ring først</div>}
                  </Link>
                ))}
              </div>
            </section>
          );
        })
      )}
    </>
  );
}
