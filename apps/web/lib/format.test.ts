import { describe, expect, it } from 'vitest';
import { formatUpdated } from './format.ts';

describe('formatUpdated', () => {
  it('formats an ISO date as "D. måned ÅÅÅÅ" in Danish', () => {
    expect(formatUpdated('2026-07-02')).toBe('2. juli 2026');
    expect(formatUpdated('2026-12-24')).toBe('24. december 2026');
    expect(formatUpdated('2027-01-05')).toBe('5. januar 2027');
  });
});
