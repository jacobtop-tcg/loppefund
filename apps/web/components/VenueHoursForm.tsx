'use client';

import { useEffect, useState } from 'react';
import { buildOsmHours, type DayHours } from '../lib/build-osm-hours.ts';

// Community OPENING-HOURS contribution. CVR and most sources give a shop's name
// and address but NOT its hours — yet "hvad er åbent i dag?" depends on them, and
// coverage sits at ~45%. This is the only realistic lever to close that gap: a
// visitor who knows a shop adds its hours in a few taps. Same zero-backend path
// as the other contribution forms — POST to Web3Forms when a key is configured,
// else a prefilled mailto — and the operator vets each submission into
// data/venue-hours.json, which the crawl applies to hours-less venues. Remembered
// in localStorage so the picker reflects the visitor's own action on revisit.
const WEB3FORMS_KEY = process.env.NEXT_PUBLIC_WEB3FORMS_KEY;
const TIP_EMAIL = process.env.NEXT_PUBLIC_TIP_EMAIL ?? 'hej@loppefund.dk';

const DAY_NAMES = ['Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag', 'Søndag'];
const storageKey = (slug: string) => `loppefund:hours-added:${slug}`;

const initialDays = (): DayHours[] =>
  Array.from({ length: 7 }, (_, i) => ({ open: i < 5, from: '10:00', to: i < 5 ? '17:00' : '14:00' }));

export function VenueHoursForm({ slug, title, url }: { slug: string; title: string; url: string }) {
  const [submitted, setSubmitted] = useState(false);
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState<DayHours[]>(initialDays);
  const [state, setState] = useState<'idle' | 'sending' | 'error'>('idle');

  useEffect(() => {
    try {
      if (localStorage.getItem(storageKey(slug))) setSubmitted(true);
    } catch {
      /* private mode — ignore */
    }
  }, [slug]);

  const osm = buildOsmHours(days);

  function setDay(i: number, patch: Partial<DayHours>) {
    setDays((prev) => prev.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  }

  async function submit() {
    if (!osm) return;
    setState('sending');
    let ok = true;
    if (WEB3FORMS_KEY) {
      try {
        const res = await fetch('https://api.web3forms.com/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            access_key: WEB3FORMS_KEY,
            subject: `Åbningstider: ${title}`,
            from_name: 'Loppefund åbningstider',
            type: 'venue-hours',
            sted: title,
            slug,
            aabningstider_osm: osm,
            url,
          }),
        });
        ok = res.ok;
      } catch {
        ok = false;
      }
    } else {
      const body = `Åbningstider for ${title}:\n${osm}\nSlug: ${slug}\nURL: ${url}`;
      window.location.href = `mailto:${TIP_EMAIL}?subject=${encodeURIComponent(
        `Åbningstider: ${title}`,
      )}&body=${encodeURIComponent(body)}`;
    }

    if (ok) {
      try {
        localStorage.setItem(storageKey(slug), new Date().toISOString());
      } catch {
        /* private mode — the submission still went through */
      }
      setSubmitted(true);
      setState('idle');
    } else {
      setState('error');
    }
  }

  if (submitted) {
    return (
      <p className="hours-add-done" role="status">
        🕑 Tak — vi tjekker dine åbningstider og lægger dem op. Det hjælper alle.
      </p>
    );
  }

  if (!open) {
    return (
      <button type="button" className="hours-add-cta" onClick={() => setOpen(true)}>
        🕑 Kender du åbningstiderne? Tilføj dem
      </button>
    );
  }

  return (
    <div className="hours-add">
      <p className="hours-add-intro">Sæt et flueben ved de dage butikken har åbent, og angiv tiderne.</p>
      <table className="hours-add-grid">
        <tbody>
          {DAY_NAMES.map((name, i) => (
            <tr key={i} className={days[i]!.open ? '' : 'is-closed'}>
              <th scope="row">
                <label>
                  <input
                    type="checkbox"
                    checked={days[i]!.open}
                    onChange={(e) => setDay(i, { open: e.target.checked })}
                  />{' '}
                  {name}
                </label>
              </th>
              <td>
                {days[i]!.open ? (
                  <span className="hours-add-times">
                    <input
                      type="time"
                      aria-label={`${name} fra`}
                      value={days[i]!.from}
                      onChange={(e) => setDay(i, { from: e.target.value })}
                    />
                    <span aria-hidden>–</span>
                    <input
                      type="time"
                      aria-label={`${name} til`}
                      value={days[i]!.to}
                      onChange={(e) => setDay(i, { to: e.target.value })}
                    />
                  </span>
                ) : (
                  <span className="hours-add-shut">Lukket</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="hours-add-actions">
        <button
          type="button"
          className="hours-add-submit"
          onClick={submit}
          disabled={!osm || state === 'sending'}
        >
          {state === 'sending' ? 'Sender…' : 'Send åbningstider'}
        </button>
        <button type="button" className="hours-add-cancel" onClick={() => setOpen(false)}>
          Fortryd
        </button>
      </div>
      {!osm && <p className="hours-add-hint">Vælg mindst én åben dag med gyldige tider.</p>}
      {state === 'error' && <p className="tip-error">Noget gik galt — prøv igen om lidt.</p>}
    </div>
  );
}
