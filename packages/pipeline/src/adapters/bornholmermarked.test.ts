import { describe, expect, it } from 'vitest';
import { extractMarket } from './bornholmermarked.ts';

const today = '2026-07-01';

/** Build an event page with a schema.org Product (name + description). */
function page(name: string, description: string): string {
  const j = JSON.stringify({ '@context': 'https://schema.org', '@type': 'Product', name, description });
  return `<html><head><script type="application/ld+json">${j}</script></head><body></body></html>`;
}

describe('bornholmermarked extractMarket', () => {
  it('keeps a dated market and resolves the Bornholm town from the title', () => {
    const html = page(
      'Kræmmermarked på Skippertorvet i Nexø',
      'Kræmmermarked på Skippertorvet i Nexø hver fredag den 10. juli 2026 kl. 10.00 - 15.00.',
    );
    const raw = extractMarket('https://x/e/1', html, today);
    expect(raw).not.toBeNull();
    expect(raw!.sourceKey).toBe('bornholmermarked');
    expect(raw!.title).toContain('Kræmmermarked');
    expect(raw!.postcode).toBe('3730');
    expect(raw!.city).toBe('Nexø');
    expect(raw!.occurrences?.[0]?.date).toBe('2026-07-10');
  });

  it('drops a second-hand item ad (no market word in the title)', () => {
    const html = page(
      'Flere Billige ting',
      'Flere billige ting sælges. Ring og byd. Fra den 30. juli til 6. august 2026.',
    );
    expect(extractMarket('https://x/e/2', html, today)).toBeNull();
  });

  it('drops an undated ad-hoc market ("open when the flag is out")', () => {
    const html = page(
      'Lauras Loppemarked i Poulsker',
      'Lopper på Poulskervej 1. Når flaget og skilt er ude er der åbent.',
    );
    expect(extractMarket('https://x/e/3', html, today)).toBeNull();
  });

  it('drops a street that is really a mis-parsed date fragment', () => {
    const html = page('Loppemarked i Østerlars', 'Lørdag den 4. juli kl. 10 er der loppemarked.');
    const raw = extractMarket('https://x/e/4', html, today);
    expect(raw).not.toBeNull();
    expect(raw!.street).toBeUndefined(); // "Lørdag den 4" is not an address
    expect(raw!.postcode).toBe('3760'); // Østerlars
  });
});
