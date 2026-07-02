'use client';

import { useCallback, useSyncExternalStore } from 'react';

// Zero-backend favorites: persisted in localStorage, so "Gemte markeder"
// works on a fully static, free-hosted site with no accounts. A storage
// event + a same-tab custom event keep every card and the chip in sync.
const KEY = 'loppefund:favorites';
const EVENT = 'loppefund:favorites-changed';

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
  window.localStorage.setItem(KEY, JSON.stringify([...set]));
  window.dispatchEvent(new Event(EVENT));
}

let cache: Set<string> | null = null;
let snapshot: string[] = [];

function getSnapshot(): string[] {
  const current = read();
  // Stable reference unless contents changed — useSyncExternalStore needs it.
  if (!cache || cache.size !== current.size || [...current].some((s) => !cache!.has(s))) {
    cache = current;
    snapshot = [...current].sort();
  }
  return snapshot;
}

function subscribe(cb: () => void): () => void {
  window.addEventListener('storage', cb);
  window.addEventListener(EVENT, cb);
  return () => {
    window.removeEventListener('storage', cb);
    window.removeEventListener(EVENT, cb);
  };
}

export function useFavorites() {
  const slugs = useSyncExternalStore(subscribe, getSnapshot, () => snapshot);
  const toggle = useCallback((slug: string) => {
    const set = read();
    if (set.has(slug)) set.delete(slug);
    else set.add(slug);
    write(set);
  }, []);
  const isFavorite = useCallback((slug: string) => slugs.includes(slug), [slugs]);
  return { favorites: slugs, count: slugs.length, toggle, isFavorite };
}
