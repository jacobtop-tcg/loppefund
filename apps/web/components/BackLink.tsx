'use client';

import Link from 'next/link';

/**
 * A back-link that PRESERVES the visitor's context. The old hard href="/" threw
 * away their filters ("odense + gratis + weekend") and scroll position — the
 * classic "now I have to start over" friction. When the visitor has browsed the
 * app this session (flag set by the Explorer), real history-back restores
 * everything; the href stays as the fallback for direct/shared entries, where
 * "back" would leave the site.
 */
export const NAV_FLAG = 'lf-visited-list';

export function BackLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="back-link"
      onClick={(e) => {
        try {
          if (sessionStorage.getItem(NAV_FLAG)) {
            e.preventDefault();
            window.history.back();
          }
        } catch {
          // sessionStorage unavailable (private mode edge) — fall through to href
        }
      }}
    >
      {children}
    </Link>
  );
}
