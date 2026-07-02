'use client';

import { useActionState } from 'react';
import { submitTip, type TipState } from './actions.ts';

const initialState: TipState = { ok: null };

export function TipForm() {
  const [state, action, pending] = useActionState(submitTip, initialState);

  if (state.ok === true) {
    return (
      <section className="panel">
        <h2>Tusind tak! 🧡</h2>
        <p style={{ color: 'var(--ink-soft)' }}>
          Dit tip er modtaget. Vi tjekker oplysningerne og lægger markedet på
          kortet — det er sådan her, Loppefund bliver komplet.
        </p>
      </section>
    );
  }

  return (
    <form action={action} className="panel tip-form">
      <label>
        <span>Link til markedet (fx et Facebook-event)</span>
        <input
          type="url"
          name="url"
          placeholder="https://www.facebook.com/events/…"
          inputMode="url"
        />
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
      {/* honeypot */}
      <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden style={{ position: 'absolute', left: -9999 }} />
      {state.error && <p className="tip-error">{state.error}</p>}
      <button type="submit" className="trip-go" disabled={pending} style={{ justifySelf: 'start' }}>
        {pending ? 'Sender…' : 'Send tip'}
      </button>
    </form>
  );
}
