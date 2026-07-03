'use client';

import { useEffect, useState } from 'react';

// Community REVIEW — a visitor rates a market 1–5 and optionally leaves a note.
// Same zero-backend, curated path as the tip/confirm/report forms: POST to
// Web3Forms when configured, else a prefilled mailto. Submissions are NOT
// auto-published — the operator vets them into data/reviews.json — so the data
// quality stays high. localStorage remembers the visitor's own review so the
// form reflects it on revisit and one person can't spam a rating in a loop.
const WEB3FORMS_KEY = process.env.NEXT_PUBLIC_WEB3FORMS_KEY;
const TIP_EMAIL = process.env.NEXT_PUBLIC_TIP_EMAIL ?? 'hej@loppefund.dk';

const storageKey = (slug: string) => `loppefund:reviewed:${slug}`;

export function ReviewForm({ slug, title, url }: { slug: string; title: string; url: string }) {
  const [done, setDone] = useState(false);
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [text, setText] = useState('');
  const [name, setName] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'error'>('idle');

  useEffect(() => {
    try {
      if (localStorage.getItem(storageKey(slug))) setDone(true);
    } catch {
      /* private mode — ignore */
    }
  }, [slug]);

  async function submit() {
    if (rating < 1) return;
    setState('sending');
    let ok = true;
    if (WEB3FORMS_KEY) {
      try {
        const res = await fetch('https://api.web3forms.com/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            access_key: WEB3FORMS_KEY,
            subject: `Anmeldelse (${rating}/5): ${title}`,
            from_name: name.trim() || 'Loppefund anmeldelse',
            type: 'review',
            marked: title,
            slug,
            url,
            rating,
            anmeldelse: text.trim(),
            navn: name.trim(),
          }),
        });
        ok = res.ok;
      } catch {
        ok = false;
      }
    } else {
      const body = `Min anmeldelse af dette marked.\nStjerner: ${rating}/5\nNavn: ${name.trim()}\nAnmeldelse: ${text.trim()}\nMarked: ${title}\nURL: ${url}`;
      window.location.href = `mailto:${TIP_EMAIL}?subject=${encodeURIComponent(
        `Anmeldelse (${rating}/5): ${title}`,
      )}&body=${encodeURIComponent(body)}`;
    }

    if (ok) {
      try {
        localStorage.setItem(storageKey(slug), new Date().toISOString());
      } catch {
        /* private mode — the review still went through */
      }
      setDone(true);
      setState('idle');
    } else {
      setState('error');
    }
  }

  if (done) {
    return (
      <p className="confirm-done" role="status">
        🧡 Tak for din anmeldelse — den hjælper andre med at vælge.
      </p>
    );
  }

  const shown = hover || rating;
  return (
    <div className="review-form">
      <div
        className="review-stars-input"
        role="radiogroup"
        aria-label="Giv en bedømmelse fra 1 til 5 stjerner"
      >
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            className={`review-star${n <= shown ? ' on' : ''}`}
            role="radio"
            aria-checked={rating === n}
            aria-label={`${n} ${n === 1 ? 'stjerne' : 'stjerner'}`}
            onMouseEnter={() => setHover(n)}
            onMouseLeave={() => setHover(0)}
            onClick={() => setRating(n)}
          >
            {n <= shown ? '★' : '☆'}
          </button>
        ))}
      </div>
      <textarea
        className="review-text"
        placeholder="Hvordan var markedet? (valgfrit)"
        rows={2}
        maxLength={600}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <input
        className="review-name"
        type="text"
        placeholder="Dit navn (valgfrit)"
        maxLength={40}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <p className="review-actions">
        <button
          type="button"
          className="confirm-link"
          onClick={submit}
          disabled={rating < 1 || state === 'sending'}
        >
          {state === 'sending' ? 'Sender…' : 'Send anmeldelse'}
        </button>
        {rating < 1 && <span className="review-hint"> Vælg antal stjerner først</span>}
        {state === 'error' && <span className="tip-error"> Noget gik galt — prøv igen.</span>}
      </p>
    </div>
  );
}
