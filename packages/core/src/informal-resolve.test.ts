import { describe, expect, it } from 'vitest';
import {
  detectRecurrence,
  distinctiveTokens,
  matchInformalPlaces,
  normalizeFacebookUrl,
  normalizePhone,
  normalizeStreet,
} from './informal-resolve.ts';
import type { InformalPlace } from './informal-place.ts';

type C = Parameters<typeof matchInformalPlaces>[0];
const cand = (o: Partial<C> = {}): C => ({
  canonicalName: 'Loppemarked',
  aliases: [],
  placeType: 'loppelade',
  street: null,
  city: null,
  lat: null,
  lng: null,
  phone: null,
  facebookUrl: null,
  contactName: null,
  recurrence: null,
  ...o,
}) as C;

describe('normalizePhone', () => {
  it('normalises every Danish form to the same key', () => {
    const want = '4520304050';
    for (const raw of ['+45 20 30 40 50', '0045 20304050', '20304050', '20 30 40 50', 'tlf. 20-30-40-50']) {
      expect(normalizePhone(raw)).toBe(want);
    }
  });

  it('refuses what is not a real DK number — a partial must never be a merge key', () => {
    for (const bad of ['123', '1234567', '+46 70 123 45 67', '10304050', '', null, undefined]) {
      expect(normalizePhone(bad as string)).toBeNull();
    }
  });

  it('refuses placeholders that would merge strangers', () => {
    expect(normalizePhone('12345678')).toBeNull();
    expect(normalizePhone('22222222')).toBeNull();
  });
});

describe('normalizeFacebookUrl', () => {
  it('reduces profiles, pages and groups to a stable identity', () => {
    expect(normalizeFacebookUrl('https://www.facebook.com/LoppeladenIGuderup')).toBe('page:loppeladenguderup'.replace('loppeladenguderup', 'loppeladeniguderup'));
    expect(normalizeFacebookUrl('https://facebook.com/groups/1575345569157850/')).toBe('group:1575345569157850');
    expect(normalizeFacebookUrl('https://www.facebook.com/profile.php?id=61575636704421')).toBe('profile:61575636704421');
  });

  it('does not treat a POST url as an identity (a post is not a person)', () => {
    expect(normalizeFacebookUrl('https://www.facebook.com/permalink/123')).toBeNull();
    expect(normalizeFacebookUrl('https://www.facebook.com/photo/?fbid=1')).toBeNull();
  });

  it('rejects non-Facebook urls', () => {
    expect(normalizeFacebookUrl('https://example.dk/x')).toBeNull();
  });
});

describe('distinctiveTokens', () => {
  it('drops the generic words that name nothing', () => {
    expect(distinctiveTokens('Stort loppemarked')).toEqual([]);
    expect(distinctiveTokens('Loppeladen i Guderup')).toContain('guderup');
  });
});

describe('normalizeStreet', () => {
  it('folds house-number variants together', () => {
    expect(normalizeStreet('Bagvejen 12 B')).toBe(normalizeStreet('bagvejen 12b'));
  });
  it('rejects a street with no number (not identifying)', () => {
    expect(normalizeStreet('Bagvejen')).toBeNull();
  });
});

describe('matchInformalPlaces', () => {
  it('merges on a shared phone number', () => {
    const r = matchInformalPlaces(
      cand({ phone: '+45 20 30 40 50' }),
      cand({ phone: '20304050', canonicalName: 'Lopper i laden' }),
    );
    expect(r.verdict).toBe('merge');
    expect(r.reasons).toContain('Samme telefonnummer');
  });

  it('merges on a shared Facebook identity', () => {
    const r = matchInformalPlaces(
      cand({ facebookUrl: 'https://facebook.com/LoppeladenGuderup' }),
      cand({ facebookUrl: 'https://www.facebook.com/loppeladenguderup/' }),
    );
    expect(r.verdict).toBe('merge');
  });

  it('REFUSES to merge two different sellers on the same road (the core safety rule)', () => {
    const a = cand({ street: 'Bygaden 4', city: 'Guderup', lat: 54.99, lng: 9.866 });
    const b = cand({ street: 'Bygaden 18', city: 'Guderup', lat: 54.9905, lng: 9.8665 });
    const r = matchInformalPlaces(a, b);
    expect(r.verdict).toBe('distinct');
    expect(r.reasons.join(' ')).toMatch(/Forskellige adresser/);
  });

  it('vetoes outright when the phone numbers differ, however close they are', () => {
    const r = matchInformalPlaces(
      cand({ phone: '20304050', street: 'Bygaden 4', city: 'Guderup', lat: 54.99, lng: 9.866 }),
      cand({ phone: '20304051', street: 'Bygaden 4', city: 'Guderup', lat: 54.99, lng: 9.866 }),
    );
    expect(r.verdict).toBe('distinct');
    expect(r.reasons[0]).toMatch(/Forskellige telefonnumre/);
  });

  it('sends a plausible-but-unproven pair to review rather than merging it', () => {
    const r = matchInformalPlaces(
      cand({ canonicalName: 'Loppeladen i Guderup', street: 'Bygaden 4', city: 'Guderup', lat: 54.99, lng: 9.866 }),
      cand({ canonicalName: 'Loppelade Guderup', street: 'Bygaden 4', city: 'Guderup', lat: 54.9901, lng: 9.8661 }),
    );
    expect(r.verdict).toBe('review');
    expect(r.reasons.join(' ')).toMatch(/Samme adresse og by/);
  });

  it('never merges two generic unnamed posts on proximity alone', () => {
    const r = matchInformalPlaces(
      cand({ canonicalName: 'Loppemarked', lat: 55.0, lng: 10.0 }),
      cand({ canonicalName: 'Loppemarked', lat: 55.0002, lng: 10.0002 }),
    );
    expect(r.verdict).not.toBe('merge');
  });

  it('always explains itself', () => {
    const r = matchInformalPlaces(cand({ phone: '20304050' }), cand({ phone: '20304050' }));
    expect(r.reasons.length).toBeGreaterThan(0);
  });
});

describe('detectRecurrence — a one-off sale must never become a permanent place', () => {
  it('calls a spread-out series of observations recurring', () => {
    const r = detectRecurrence(['2026-05-03', '2026-06-07', '2026-07-05']);
    expect(r.isRecurring).toBe(true);
    expect(r.reason).toMatch(/tilbagevendende skjult loppested/);
  });

  it('refuses a burst of posts about ONE weekend', () => {
    const r = detectRecurrence(['2026-07-01', '2026-07-02', '2026-07-03', '2026-07-04']);
    expect(r.isRecurring).toBe(false);
    expect(r.reason).toMatch(/ligner ét salg/);
  });

  it('refuses too few observations', () => {
    expect(detectRecurrence(['2026-01-01', '2026-06-01']).isRecurring).toBe(false);
  });

  it('ignores duplicate dates (the same post seen twice is one observation)', () => {
    const r = detectRecurrence(['2026-05-03', '2026-05-03', '2026-05-03']);
    expect(r.isRecurring).toBe(false);
  });
});
