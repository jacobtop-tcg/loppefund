/**
 * Single source of truth for how a canonical event's confidence score maps to a
 * human trust label. The card badge ("Ubekræftet") and the detail-page trust
 * meter ("Godt bekræftet" / "Bekræftet" / "Ubekræftet") previously hard-coded
 * the same 0.45 / 0.75 cutoffs in two files; if they ever drifted, a card could
 * call a market unverified while its own page called it confirmed — exactly the
 * kind of incoherent trust signal the product must never emit. Import from here.
 */

/** At/above this confidence a market is "Godt bekræftet". */
export const TRUST_CONFIRMED = 0.75;
/** Below this confidence a market is "Ubekræftet" (single, uncorroborated source). */
export const TRUST_UNVERIFIED = 0.45;

export type TrustLevel = 'confirmed' | 'ok' | 'unverified';

export function trustLevel(confidence: number): TrustLevel {
  if (confidence >= TRUST_CONFIRMED) return 'confirmed';
  if (confidence >= TRUST_UNVERIFIED) return 'ok';
  return 'unverified';
}

const TRUST_LABELS: Record<TrustLevel, string> = {
  confirmed: 'Godt bekræftet',
  ok: 'Bekræftet',
  unverified: 'Ubekræftet',
};

export function trustLabel(confidence: number): string {
  return TRUST_LABELS[trustLevel(confidence)];
}

/** True when the market should carry the "Ubekræftet" warning. */
export function isUnverified(confidence: number): boolean {
  return trustLevel(confidence) === 'unverified';
}
