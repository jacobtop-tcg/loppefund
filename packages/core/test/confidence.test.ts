import { describe, expect, it } from 'vitest';
import {
  computeConfidence,
  COMMUNITY_CONFIRM_QUORUM,
  UNVERIFIED_THRESHOLD,
} from '../src/confidence.ts';

// A market found only on one low-trust source (a Facebook post, trust 0.4) —
// fresh, located and dated, but uncorroborated.
const fbSolo = {
  maxSourceTrust: 0.4,
  sourceCount: 1,
  daysSinceVerified: 0,
  hasGoodLocation: true,
  hasConcreteDates: true,
};

describe('computeConfidence — community confirmations', () => {
  it('stays "ubekræftet" with no confirmations', () => {
    expect(computeConfidence(fbSolo)).toBeLessThan(UNVERIFIED_THRESHOLD);
  });

  it('one tap can never confirm', () => {
    expect(
      computeConfidence({ ...fbSolo, communityConfirmations: 1 }),
    ).toBeLessThan(UNVERIFIED_THRESHOLD);
  });

  it('below-quorum confirmations do NOT lift it past the threshold', () => {
    expect(
      computeConfidence({ ...fbSolo, communityConfirmations: COMMUNITY_CONFIRM_QUORUM - 1 }),
    ).toBeLessThan(UNVERIFIED_THRESHOLD);
  });

  it('a quorum of confirmations corroborates it past the threshold', () => {
    expect(
      computeConfidence({ ...fbSolo, communityConfirmations: COMMUNITY_CONFIRM_QUORUM }),
    ).toBeGreaterThanOrEqual(UNVERIFIED_THRESHOLD);
  });

  it('crowd-only trust is capped below authoritative-source levels (never rock-solid)', () => {
    expect(computeConfidence({ ...fbSolo, communityConfirmations: 50 })).toBeLessThanOrEqual(0.6);
  });

  it('does not weaken an already well-sourced event', () => {
    const twoSources = { ...fbSolo, maxSourceTrust: 0.7, sourceCount: 2 };
    expect(computeConfidence(twoSources)).toBeGreaterThanOrEqual(UNVERIFIED_THRESHOLD);
  });
});
