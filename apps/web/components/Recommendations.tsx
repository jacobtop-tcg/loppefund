'use client';

import { memo } from 'react';
import type { Recommendation } from '../lib/recommend.ts';
import { displayPlace, displayTitle } from '../lib/format.ts';

/**
 * "Til dig" — a compact strip of personalized top picks at the head of the list.
 * Answers "where should we go this weekend?" at a glance. Hidden when there are
 * too few good picks so it never feels like filler.
 */
export const Recommendations = memo(function Recommendations({
  recs,
  hasPos = false,
}: {
  recs: Recommendation[];
  hasPos?: boolean;
}) {
  if (recs.length < 2) return null;
  const base = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
  // "Til dig" only rings true once we know where the visitor is; without a
  // location the picks are curated, not personalized — so say so honestly.
  const heading = hasPos ? 'Til dig' : 'Anbefalede markeder';
  // One honest, contextual line so the strip explains itself.
  const subtitle = recs.some((r) => r.isFavorite)
    ? 'Bl.a. dine gemte — og nye fund du vil kunne lide'
    : hasPos
      ? 'De bedste bud tæt på dig lige nu'
      : 'Håndplukkede fund — slå din placering til for bud i nærheden';
  return (
    <section className="reco" aria-label={heading}>
      <h2 className="reco-title">{heading}</h2>
      <p className="reco-sub">{subtitle}</p>
      <div className="reco-row">
        {recs.map((r) => (
          <a key={r.event.slug} className="reco-card" href={`${base}/marked/${r.event.slug}`}>
            <span className="reco-name">{displayTitle(r.event.title)}</span>
            {r.event.city && <span className="reco-city">{displayPlace(r.event.city)}</span>}
            <span className="reco-reasons">
              {r.reasons.map((reason, i) => (
                <span key={i} className={`reco-chip${i === 0 ? ' when' : ''}`}>
                  {reason}
                </span>
              ))}
            </span>
          </a>
        ))}
      </div>
    </section>
  );
});
