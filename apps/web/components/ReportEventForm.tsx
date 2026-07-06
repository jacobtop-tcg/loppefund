'use client';

import { useEffect, useState } from 'react';

// Per-event community correction: the lowest-friction way for a visitor to flag
// an INCORRECT event (the one thing the trust model must never tolerate). Reuses
// the tip form's zero-backend path — POST to Web3Forms when a key is configured
// (NEXT_PUBLIC_WEB3FORMS_KEY), otherwise a prefilled mailto so it works on any
// static host. Collapsed by default to keep the page clutter-free.
const WEB3FORMS_KEY = process.env.NEXT_PUBLIC_WEB3FORMS_KEY;
const TIP_EMAIL = process.env.NEXT_PUBLIC_TIP_EMAIL ?? 'hej@loppefund.dk';

const REASONS = [
  'Markedet er aflyst',
  'Forkert dato eller tid',
  'Forkert sted eller adresse',
  'Findes ikke / permanent lukket',
  'Noget andet',
];

export function ReportEventForm({ title, url }: { title: string; url: string }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');
  // Remember on this device that a report was sent, so a returning visitor sees
  // the acknowledgement instead of being nudged to report the same thing again.
  // Read after mount (never in the useState initializer) so the static HTML and
  // first client render agree — no hydration mismatch.
  const storageKey = `lf:reported:${url}`;
  const [reportedBefore, setReportedBefore] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem(storageKey)) setReportedBefore(true);
    } catch {
      // private mode / disabled storage — just don't restore the flag
    }
  }, [storageKey]);
  const remember = () => {
    try {
      localStorage.setItem(storageKey, '1');
    } catch {
      // quota / private mode — the in-session 'done' state still acknowledges it
    }
  };

  if (state === 'done') {
    return (
      <p className="trust-note" role="status">
        Tak for hjælpen! 🧡 Vi tjekker det hurtigst muligt — sådan holder vi Loppefund
        troværdig.
      </p>
    );
  }

  if (reportedBefore && !open) {
    return (
      <p className="trust-note" role="status">
        Du har meldt en fejl her — tak!{' '}
        <button
          type="button"
          className="report-link"
          onClick={() => {
            setReportedBefore(false);
            setOpen(true);
          }}
        >
          Meld en ny fejl
        </button>
      </p>
    );
  }

  if (!open) {
    return (
      <p className="trust-note">
        <button type="button" className="report-link" onClick={() => setOpen(true)}>
          Er noget forkert eller aflyst? Meld en fejl
        </button>
      </p>
    );
  }

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    if (String(data.get('website') ?? '')) return; // honeypot
    const comment = String(data.get('comment') ?? '').trim();
    const contact = String(data.get('contact') ?? '').trim();
    const problem = reason || 'Rettelse';

    if (WEB3FORMS_KEY) {
      setState('sending');
      try {
        const res = await fetch('https://api.web3forms.com/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            access_key: WEB3FORMS_KEY,
            subject: `Rettelse: ${title}`,
            from_name: 'Loppefund rettelse',
            marked: title,
            url,
            problem,
            comment,
            contact,
          }),
        });
        if (res.ok) remember();
        setState(res.ok ? 'done' : 'error');
      } catch {
        setState('error');
      }
      return;
    }

    // Zero-config fallback: hand off to the visitor's mail client, prefilled.
    const body = `Marked: ${title}\nURL: ${url}\nProblem: ${problem}\n\n${comment}\n\nKontakt: ${contact}`;
    window.location.href = `mailto:${TIP_EMAIL}?subject=${encodeURIComponent(
      `Rettelse: ${title}`,
    )}&body=${encodeURIComponent(body)}`;
    remember();
    setState('done');
  }

  return (
    <form onSubmit={submit} className="report-form">
      <div className="report-reasons" role="group" aria-label="Hvad er der galt?">
        {REASONS.map((r) => (
          <button
            type="button"
            key={r}
            className={`report-chip${reason === r ? ' active' : ''}`}
            aria-pressed={reason === r}
            onClick={() => setReason(r)}
          >
            {r}
          </button>
        ))}
      </div>
      <textarea name="comment" rows={2} placeholder="Uddyb gerne (valgfrit)…" />
      <input type="email" name="contact" placeholder="Din e-mail (valgfrit — hvis vi må spørge)" />
      <input
        type="text"
        name="website"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden
        style={{ position: 'absolute', left: -9999 }}
      />
      {state === 'error' && <p className="tip-error">Noget gik galt — prøv igen om lidt.</p>}
      <button
        type="submit"
        className="trip-go"
        disabled={state === 'sending' || !reason}
        style={{ justifySelf: 'start' }}
      >
        {state === 'sending' ? 'Sender…' : 'Send rettelse'}
      </button>
    </form>
  );
}
