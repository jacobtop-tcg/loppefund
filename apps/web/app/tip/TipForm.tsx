'use client';

import { useState } from 'react';

// Free, no-server tip intake. If a Web3Forms access key is configured
// (NEXT_PUBLIC_WEB3FORMS_KEY — free, 250 submissions/month, no account beyond
// an email) the tip is POSTed there and lands in the operator's inbox.
// Without a key it falls back to a mailto: link, so the form works with zero
// setup on any static host.
const WEB3FORMS_KEY = process.env.NEXT_PUBLIC_WEB3FORMS_KEY;
const TIP_EMAIL = process.env.NEXT_PUBLIC_TIP_EMAIL ?? 'hej@loppefund.dk';

export function TipForm() {
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');
  const [error, setError] = useState('');

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    if (String(data.get('website') ?? '')) return; // honeypot
    const url = String(data.get('url') ?? '').trim();
    const text = String(data.get('text') ?? '').trim();
    const contact = String(data.get('contact') ?? '').trim();
    if (!url && !text) {
      setError('Indsæt et link eller opslagets tekst.');
      return;
    }
    setError('');

    if (WEB3FORMS_KEY) {
      setState('sending');
      try {
        const res = await fetch('https://api.web3forms.com/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            access_key: WEB3FORMS_KEY,
            subject: 'Nyt marked-tip til Loppefund',
            from_name: 'Loppefund tip',
            url,
            text,
            contact,
          }),
        });
        setState(res.ok ? 'done' : 'error');
      } catch {
        setState('error');
      }
      return;
    }

    // Zero-config fallback: hand off to the visitor's mail client.
    const body = `Link: ${url}\n\nTekst:\n${text}\n\nKontakt: ${contact}`;
    window.location.href = `mailto:${TIP_EMAIL}?subject=${encodeURIComponent(
      'Nyt marked-tip til Loppefund',
    )}&body=${encodeURIComponent(body)}`;
    setState('done');
  }

  if (state === 'done') {
    return (
      <section className="panel">
        <h2>Tusind tak! 🧡</h2>
        <p style={{ color: 'var(--ink-soft)' }}>
          Dit tip er på vej. Vi tjekker oplysningerne og lægger markedet på kortet —
          det er sådan her, Loppefund bliver komplet.
        </p>
      </section>
    );
  }

  return (
    <form onSubmit={onSubmit} className="panel tip-form">
      <label>
        <span>Link til markedet (fx et Facebook-event)</span>
        <input type="url" name="url" placeholder="https://www.facebook.com/events/…" inputMode="url" />
      </label>
      <label>
        <span>Eller indsæt opslagets tekst</span>
        <textarea
          name="text"
          rows={7}
          placeholder={'Fx: "Stort loppemarked på Byvej 12, 4000 Roskilde, lørdag den 11. juli kl. 10-16 …"'}
        />
      </label>
      <label>
        <span>Din e-mail (valgfrit — hvis vi må spørge ind)</span>
        <input type="email" name="contact" placeholder="dig@eksempel.dk" />
      </label>
      <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden style={{ position: 'absolute', left: -9999 }} />
      {error && <p className="tip-error">{error}</p>}
      {state === 'error' && <p className="tip-error">Noget gik galt — prøv igen om lidt.</p>}
      <button type="submit" className="trip-go" disabled={state === 'sending'} style={{ justifySelf: 'start' }}>
        {state === 'sending' ? 'Sender…' : 'Send tip'}
      </button>
    </form>
  );
}
