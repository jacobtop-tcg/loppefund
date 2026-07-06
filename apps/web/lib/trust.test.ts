import { describe, expect, it } from 'vitest';
import { isUnverified, trustLabel, trustLevel, TRUST_CONFIRMED, TRUST_UNVERIFIED } from './trust.ts';

describe('trust thresholds', () => {
  it('maps confidence to the three levels at the shared cutoffs', () => {
    expect(trustLevel(TRUST_CONFIRMED)).toBe('confirmed');
    expect(trustLevel(0.9)).toBe('confirmed');
    expect(trustLevel(TRUST_UNVERIFIED)).toBe('ok');
    expect(trustLevel(0.6)).toBe('ok');
    expect(trustLevel(TRUST_UNVERIFIED - 0.01)).toBe('unverified');
    expect(trustLevel(0)).toBe('unverified');
  });

  it('labels each level in Danish', () => {
    expect(trustLabel(0.9)).toBe('Godt bekræftet');
    expect(trustLabel(0.6)).toBe('Bekræftet');
    expect(trustLabel(0.3)).toBe('Ubekræftet');
  });

  it('isUnverified is exactly the below-cutoff band the card badge uses', () => {
    expect(isUnverified(0.44)).toBe(true);
    expect(isUnverified(0.45)).toBe(false);
  });
});
