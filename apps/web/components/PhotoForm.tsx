'use client';

import { useEffect, useRef, useState } from 'react';

// Community PHOTO submission. A visitor picks an image from the market; it goes
// to the operator inbox for vetting (never auto-published). When a Web3Forms key
// is configured we POST multipart with the file attached; otherwise we open a
// prefilled mailto and ask them to attach it (mail clients can't be handed a
// file programmatically). Curated photos then land in apps/web/public and
// data/photos.json. localStorage remembers the visitor's submit so the control
// reflects it on return.
const WEB3FORMS_KEY = process.env.NEXT_PUBLIC_WEB3FORMS_KEY;
const TIP_EMAIL = process.env.NEXT_PUBLIC_TIP_EMAIL ?? 'hej@loppefund.dk';
const MAX_BYTES = 5 * 1024 * 1024; // Web3Forms free-tier attachment ceiling.

const storageKey = (slug: string) => `loppefund:photo:${slug}`;

export function PhotoForm({ slug, title, url }: { slug: string; title: string; url: string }) {
  const [done, setDone] = useState(false);
  const [state, setState] = useState<'idle' | 'sending' | 'error' | 'toobig'>('idle');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      if (localStorage.getItem(storageKey(slug))) setDone(true);
    } catch {
      /* private mode — ignore */
    }
  }, [slug]);

  async function onFile(file: File) {
    if (file.size > MAX_BYTES) {
      setState('toobig');
      return;
    }
    setState('sending');
    let ok = true;
    if (WEB3FORMS_KEY) {
      try {
        const form = new FormData();
        form.append('access_key', WEB3FORMS_KEY);
        form.append('subject', `Foto til marked: ${title}`);
        form.append('from_name', 'Loppefund foto');
        form.append('type', 'photo');
        form.append('marked', title);
        form.append('slug', slug);
        form.append('url', url);
        form.append('billede', file, file.name);
        const res = await fetch('https://api.web3forms.com/submit', { method: 'POST', body: form });
        ok = res.ok;
      } catch {
        ok = false;
      }
    } else {
      const body = `Jeg har et billede fra dette marked (vedhæft billedet i denne mail).\nMarked: ${title}\nURL: ${url}`;
      window.location.href = `mailto:${TIP_EMAIL}?subject=${encodeURIComponent(
        `Foto til marked: ${title}`,
      )}&body=${encodeURIComponent(body)}`;
    }

    if (ok) {
      try {
        localStorage.setItem(storageKey(slug), new Date().toISOString());
      } catch {
        /* private mode — the photo still went through */
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
        📷 Tak — dit billede er sendt til gennemsyn. Vi lægger det op, hvis det passer.
      </p>
    );
  }

  return (
    <p className="photo-cta">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onFile(f);
        }}
      />
      <button
        type="button"
        className="confirm-link"
        onClick={() => inputRef.current?.click()}
        disabled={state === 'sending'}
      >
        {state === 'sending' ? 'Sender…' : '📷 Del et billede fra markedet'}
      </button>
      {state === 'toobig' && <span className="tip-error"> Billedet må højst fylde 5 MB.</span>}
      {state === 'error' && <span className="tip-error"> Noget gik galt — prøv igen.</span>}
    </p>
  );
}
