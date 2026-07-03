import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearSavedLocation,
  coarsen,
  readSavedLocation,
  writeSavedLocation,
} from './saved-location.ts';

describe('coarsen', () => {
  it('rounds coordinates to 3 decimals (~110 m)', () => {
    expect(coarsen(55.676098123)).toBe(55.676);
    expect(coarsen(12.568300987)).toBe(12.568);
    expect(coarsen(-0.00049)).toBe(-0);
  });
});

describe('saved location persistence', () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    (globalThis as unknown as { window: unknown }).window = {
      localStorage: {
        getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
        setItem: (k: string, v: string) => {
          store.set(k, v);
        },
        removeItem: (k: string) => {
          store.delete(k);
        },
      },
    };
  });
  afterEach(() => {
    store.clear();
    delete (globalThis as unknown as { window?: unknown }).window;
  });

  it('round-trips a location, coarsening the coordinates', () => {
    writeSavedLocation({ lat: 55.676098, lng: 12.568301, radius: 25 });
    expect(readSavedLocation()).toEqual({ lat: 55.676, lng: 12.568, radius: 25 });
  });

  it('returns null when nothing is saved', () => {
    expect(readSavedLocation()).toBeNull();
  });

  it('rejects malformed or partial data instead of throwing', () => {
    store.set('loppefund:location:v1', '{"lat":"x","lng":12.5}');
    expect(readSavedLocation()).toBeNull();
    store.set('loppefund:location:v1', 'not json at all');
    expect(readSavedLocation()).toBeNull();
    store.set('loppefund:location:v1', '{"lat":55.1}'); // missing lng
    expect(readSavedLocation()).toBeNull();
  });

  it('defaults radius to null when absent or non-numeric', () => {
    store.set('loppefund:location:v1', '{"lat":55.1,"lng":12.1}');
    expect(readSavedLocation()).toEqual({ lat: 55.1, lng: 12.1, radius: null });
    writeSavedLocation({ lat: 55.1, lng: 12.1, radius: null });
    expect(readSavedLocation()?.radius).toBeNull();
  });

  it('clears the saved location', () => {
    writeSavedLocation({ lat: 55.1, lng: 12.1, radius: 10 });
    clearSavedLocation();
    expect(readSavedLocation()).toBeNull();
  });
});
