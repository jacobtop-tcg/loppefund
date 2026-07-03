'use client';

import { useCallback, useSyncExternalStore } from 'react';

// Zero-backend favorites: persisted in localStorage, so "Gemte markeder"
// works on a fully static, free-hosted site with no accounts. A storage
// event + a same-tab custom event keep every card and the chip in sync.
const KEY = 'loppefund:favorites';
const EVENT = 'loppefund:favorites-changed';

const SERVER_SNAPSHOT: string[] = [];

function read(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function write(set: Set<string>): void {
  // Update the in-memory snapshot and notify listeners FIRST, so the toggle is
  // reflected in the UI even if persistence fails. localStorage.setItem throws
  // in Safari private mode and when the quota is exhausted — degrade to
  // session-only rather than letting the heart-button click throw uncaught
  // (read() is already guarded the same way).
  snapshot = [...set].sort();
  window.dispatchEvent(new Event(EVENT));
  try {
    window.localStorage.setItem(KEY, JSON.stringify([...set]));
  } catch {
    // Quota exceeded / private mode — the favorite won't survive a reload, but
    // the current session stays fully interactive.
  }
}

// Cached parsed snapshot: 499 subscribed cards each call getSnapshot on every
// render, so we parse localStorage only on an actual change (toggle via write,
// or a cross-tab 'storage' event) and hand back the same array reference in
// between — useSyncExternalStore must not see a fresh identity each render.
let snapshot: string[] | null = null;

function getSnapshot(): string[] {
  snapshot ??= [...read()].sort();
  return snapshot;
}

function refresh(): void {
  snapshot = [...read()].sort();
}

function subscribe(cb: () => void): () => void {
  const onStorage = () => {
    refresh();
    cb();
  };
  window.addEventListener('storage', onStorage);
  window.addEventListener(EVENT, cb);
  return () => {
    window.removeEventListener('storage', onStorage);
    window.removeEventListener(EVENT, cb);
  };
}

export function useFavorites() {
  const slugs = useSyncExternalStore(subscribe, getSnapshot, () => SERVER_SNAPSHOT);
  const toggle = useCallback((slug: string) => {
    const set = read();
    if (set.has(slug)) set.delete(slug);
    else set.add(slug);
    write(set);
  }, []);
  const isFavorite = useCallback((slug: string) => slugs.includes(slug), [slugs]);
  return { favorites: slugs, count: slugs.length, toggle, isFavorite };
}
