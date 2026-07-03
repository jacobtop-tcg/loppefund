'use client';

import { useEffect, useState } from 'react';

// Community CONFIRMATION — the positive counterpart to ReportEventForm. A visitor
// who has been to (or knows) a market taps once to corroborate it. That signal is
// exactly what raises an "ubekræftet" market toward "bekræftet", so it directly
// serves the trust mandate. Same zero-backend path as the tip/report forms:
// POST to Web3Forms when a key is configured, else a prefilled mailto. The
// confirmation is remembered in localStorage so the button reflects the visitor's
// own action on revisit and can't be spammed by one person in a loop.
const WEB3FORMS_KEY = process.env.NEXT_PUBLIC_WEB3FORMS_KEY;
const TIP_EMAIL = process.env.NEXT_PUBLIC_TIP_EMAIL ?? 'hej@loppefund.dk';

const storageKey = (slug: string) => `loppefund:confirmed:${slug}`;

export function ConfirmEventForm({
  slug,
  title,
  url,
}: {
  slug: string;
  title: string;
  url: string;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const [state, setState] = useState<'idle' | 'sending' | 'error'>('idle');

  useEffect(() => {
    try {
      if (localStorage.getItem(storageKey(slug))) setConfirmed(true);
    } catch {
      /* private mode — ignore */
    }
  }, [slug]);

  async function confirm() {
    setState('sending');
    let ok = true;
    if (WEB3FORMS_KEY) {
      try {
        const res = await fetch('https://api.web3forms.com/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            access_key: WEB3FORMS_KEY,
            subject: `Bekræftelse: ${title}`,
            from_name: 'Loppefund bekræftelse',
            type: 'confirmation',
            marked: title,
            slug,
            url,
          }),
        });
        ok = res.ok;
      } catch {
        ok = false;
      }
    } else {
      // Zero-config fallback: hand off to the visitor's mail client, prefilled.
      const body = `Jeg kan bekræfte dette marked.\nMarked: ${title}\nURL: ${url}`;
      window.location.href = `mailto:${TIP_EMAIL}?subject=${encodeURIComponent(
        `Bekræftelse: ${title}`,
      )}&body=${encodeURIComponent(body)}`;
    }

    if (ok) {
      try {
        localStorage.setItem(storageKey(slug), new Date().toISOString());
      } catch {
        /* private mode — the confirmation still went through */
      }
      setConfirmed(true);
      setState('idle');
    } else {
      setState('error');
    }
  }

  if (confirmed) {
    return (
      <p className="confirm-done" role="status">
        🧡 Tak — du har bekræftet dette marked. Det hjælper andre med at stole på det.
      </p>
    );
  }

  return (
    <p className="confirm-cta">
      <button type="button" className="confirm-link" onClick={confirm} disabled={state === 'sending'}>
        {state === 'sending' ? 'Sender…' : '✓ Har du været her? Bekræft at markedet findes'}
      </button>
      {state === 'error' && (
        <span className="tip-error"> Noget gik galt — prøv igen om lidt.</span>
      )}
    </p>
  );
}
