'use client';

import { useState } from 'react';

/**
 * One-tap sharing — the primary growth loop is a family member dropping a
 * market into the group chat. Uses the native share sheet on mobile and
 * falls back to copying the link.
 */
export function ShareButton({ title, path }: { title: string; path: string }) {
  const [copied, setCopied] = useState(false);

  async function share() {
    const url = `${window.location.origin}${path}`;
    if (navigator.share) {
      try {
        await navigator.share({ title, url });
        return;
      } catch {
        // user dismissed the sheet — fall through to copy
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable; nothing sensible left to do
    }
  }

  return (
    <button type="button" className="share-btn" onClick={share}>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <circle cx="18" cy="5" r="3" />
        <circle cx="6" cy="12" r="3" />
        <circle cx="18" cy="19" r="3" />
        <path d="m8.6 10.6 6.8-4.2m-6.8 7 6.8 4.2" />
      </svg>
      {copied ? 'Link kopieret!' : 'Del marked'}
    </button>
  );
}
