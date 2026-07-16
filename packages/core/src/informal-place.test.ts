import { describe, expect, it } from 'vitest';
import {
  trustLayerFor,
  type InformalPlace,
  type InformalSourceRecord,
  type InformalVisitReport,
} from './informal-place.ts';
import { blurCoord, findVisibilityLeaks, publicView, AREA_GRID_DEG } from './informal-visibility.ts';
import { computeInformalConfidence, INFORMAL_W, FRESH_DAYS } from './informal-confidence.ts';
import { computeFundScore, FUND_W } from './fund-score.ts';

const TODAY = '2026-07-15';

const src = (o: Partial<InformalSourceRecord> = {}): InformalSourceRecord => ({
  sourceType: 'facebook_post',
  url: 'https://www.facebook.com/groups/1/posts/2',
  observedAt: '2026-07-10',
  excerpt: 'Loppelade åben på lørdag',
  verifiedBy: null,
  ...o,
});

const visit = (o: Partial<InformalVisitReport> = {}): InformalVisitReport => ({
  visitedAt: '2026-07-01',
  wasOpen: true,
  priceLevel: null,
  stockLevel: null,
  freshStock: null,
  sellerKind: null,
  negotiable: null,
  categories: [],
  worthTheDrive: null,
  comment: null,
  reporter: 'anon',
  reportedClosed: false,
  ...o,
});

const place = (o: Partial<InformalPlace> = {}): InformalPlace => ({
  id: 1,
  slug: 'test-lade',
  canonicalName: 'Loppeladen',
  aliases: [],
  placeType: 'loppelade',
  description: null,
  street: 'Bagvejen 12',
  postcode: '5900',
  city: 'Rudkøbing',
  municipality: null,
  region: null,
  lat: 54.936261,
  lng: 10.714362,
  geoPrecision: 'exact',
  addressVisibility: 'omraade',
  contactName: null,
  phone: null,
  email: null,
  facebookUrl: null,
  websiteUrl: null,
  sources: [src()],
  firstSeenAt: '2026-06-01',
  lastSeenAt: '2026-07-10',
  lastVerifiedAt: null,
  status: 'recently_observed',
  recurrence: null,
  openingNotes: null,
  callBeforeVisiting: false,
  openWhenFlagIsOut: false,
  confidence: 0,
  fundScore: 0,
  priceLevel: null,
  inventorySignals: [],
  imageUrls: [],
  visitReports: [],
  mergedIds: [],
  moderationNotes: null,
  createdAt: '2026-06-01',
  updatedAt: '2026-07-10',
  ...o,
});

// ===========================================================================
// PRIVACY — the most important tests here. On a static host, anything that
// reaches the payload is public forever, so these guard a real-world harm:
// broadcasting a private person's home address next to a directions link.
// ===========================================================================
describe('publicView — the publication gate', () => {
  it('never publishes an internal or refused place at all', () => {
    expect(publicView(place({ addressVisibility: 'intern' }))).toBeNull();
    expect(publicView(place({ addressVisibility: 'ikke-offentlig' }))).toBeNull();
    expect(publicView(place({ status: 'rejected' }))).toBeNull();
  });

  it('strips the street and blurs the coordinate for an area-only place', () => {
    const p = place({ addressVisibility: 'omraade' });
    const v = publicView(p)!;
    expect(v.street).toBeNull();
    expect(v.areaOnly).toBe(true);
    expect(v.geoPrecision).toBe('area');
    expect(v.lat).not.toBe(p.lat); // must have moved
    expect(v.addressNote).toMatch(/omtrentligt/i);
    expect(findVisibilityLeaks(p, v)).toEqual([]);
  });

  it('publishes the full address only when explicitly allowed', () => {
    const p = place({ addressVisibility: 'fuld' });
    const v = publicView(p)!;
    expect(v.street).toBe('Bagvejen 12');
    expect(v.lat).toBe(p.lat);
    expect(v.areaOnly).toBe(false);
    expect(findVisibilityLeaks(p, v)).toEqual([]);
  });

  it('gives a kontakt-kraeves place no map pin at all', () => {
    const p = place({ addressVisibility: 'kontakt-kraeves' });
    const v = publicView(p)!;
    expect(v.lat).toBeNull();
    expect(v.lng).toBeNull();
    expect(v.street).toBeNull();
    expect(findVisibilityLeaks(p, v)).toEqual([]);
  });

  it('degrades kun-aabningsdage to area on a static host (cannot reveal later)', () => {
    const p = place({ addressVisibility: 'kun-aabningsdage' });
    const v = publicView(p)!;
    expect(v.street).toBeNull();
    expect(v.areaOnly).toBe(true);
    expect(v.addressNote).toMatch(/kontakt/i);
  });

  it('never leaks the exact excerpt or the verifier identity into public sources', () => {
    const v = publicView(place({ sources: [src({ verifiedBy: 'moderator-jacob' })] }))!;
    const blob = JSON.stringify(v);
    expect(blob).not.toContain('moderator-jacob');
    expect(blob).not.toContain('Loppelade åben på lørdag');
  });

  it('blurs deterministically (same in, same out) and by a real distance', () => {
    const a = blurCoord(54.936261, 10.714362);
    const b = blurCoord(54.936261, 10.714362);
    expect(a).toEqual(b);
    // Moved by at most about one grid cell, but genuinely moved.
    expect(Math.abs(a.lat - 54.936261)).toBeLessThanOrEqual(AREA_GRID_DEG);
    expect(a.lat).not.toBe(54.936261);
  });

  it('findVisibilityLeaks catches a hand-built leaking view (the regression guard)', () => {
    const p = place({ addressVisibility: 'omraade' });
    const leaky = { ...publicView(p)!, street: p.street, lat: p.lat, lng: p.lng, areaOnly: false, geoPrecision: 'exact' as const };
    const leaks = findVisibilityLeaks(p, leaky);
    expect(leaks.length).toBeGreaterThan(0);
    expect(leaks.join(' ')).toMatch(/street published/);
  });
});

// ===========================================================================
// CONFIDENCE — "is it real?"
// ===========================================================================
describe('computeInformalConfidence', () => {
  it('scores a lone fresh Facebook post as plausible but unconfirmed', () => {
    const r = computeInformalConfidence(
      {
        sources: [src()], visitReports: [], street: null, phone: null, lat: null, lng: null,
        geoPrecision: 'postcode', recurrence: null, openingNotes: null, imageUrls: [],
        lastSeenAt: '2026-07-10', lastVerifiedAt: null,
      },
      TODAY,
    );
    expect(r.score).toBeGreaterThan(20);
    expect(r.score).toBeLessThan(60); // one post is never "sure"
    expect(r.reasons.join(' ')).toMatch(/Aktivitet inden for/);
  });

  it('rewards the signals that actually prove a place: address, phone, corroboration, verification', () => {
    const r = computeInformalConfidence(
      {
        sources: [src(), src({ sourceType: 'local_paper', url: 'https://fyens.dk/x' }), src({ sourceType: 'phone_verification', url: null })],
        visitReports: [visit({ wasOpen: true })],
        street: 'Bagvejen 12', phone: '+45 20 30 40 50', lat: 55, lng: 10,
        geoPrecision: 'exact', recurrence: { weekdays: [7], pattern: 'hver søndag', season: null, notes: null },
        openingNotes: 'Søndage 10-16', imageUrls: ['https://x/1.jpg'],
        lastSeenAt: '2026-07-14', lastVerifiedAt: '2026-07-14',
        flags: { repeatedAddress: true, repeatedAuthor: true, consistentContact: true },
      },
      TODAY,
    );
    expect(r.score).toBeGreaterThanOrEqual(90);
    expect(r.reasons.join(' ')).toMatch(/Bekræftet telefonisk/);
  });

  it('does not let ONE closed report sink a place (quorum protects against a single voice)', () => {
    const base = {
      sources: [src(), src({ sourceType: 'user_tip', url: null })], street: 'Bagvejen 12',
      phone: '+45 20 30 40 50', lat: 55, lng: 10, geoPrecision: 'exact' as const,
      recurrence: null, openingNotes: null, imageUrls: [], lastSeenAt: '2026-07-14',
      lastVerifiedAt: null,
    };
    const one = computeInformalConfidence({ ...base, visitReports: [visit({ reportedClosed: true })] }, TODAY);
    const two = computeInformalConfidence(
      { ...base, visitReports: [visit({ reportedClosed: true }), visit({ reportedClosed: true })] },
      TODAY,
    );
    expect(two.score).toBeLessThan(one.score); // a quorum bites harder
    expect(one.score - two.score).toBeGreaterThanOrEqual(10);
  });

  it('decays an old lone observation to rumour', () => {
    const r = computeInformalConfidence(
      {
        sources: [src({ observedAt: '2024-01-01' })], visitReports: [], street: null, phone: null,
        lat: null, lng: null, geoPrecision: 'unknown', recurrence: null, openingNotes: null,
        imageUrls: [], lastSeenAt: '2024-01-01', lastVerifiedAt: null,
      },
      TODAY,
    );
    expect(r.score).toBeLessThan(20);
    expect(r.reasons.join(' ')).toMatch(/Kun én gammel observation/);
  });

  it('counts reposts of one post as ONE source (independence, not volume)', () => {
    const reposts = [src(), src({ url: 'https://www.facebook.com/groups/1/posts/3' })];
    const distinct = [src(), src({ sourceType: 'local_paper', url: 'https://fyens.dk/y' })];
    const common = {
      visitReports: [], street: null, phone: null, lat: null, lng: null,
      geoPrecision: 'postcode' as const, recurrence: null, openingNotes: null, imageUrls: [],
      lastSeenAt: '2026-07-10', lastVerifiedAt: null,
    };
    const a = computeInformalConfidence({ ...common, sources: reposts }, TODAY);
    const b = computeInformalConfidence({ ...common, sources: distinct }, TODAY);
    expect(b.score).toBeGreaterThan(a.score);
  });

  it('is deterministic and reproducible', () => {
    const input = {
      sources: [src()], visitReports: [], street: 'A 1', phone: null, lat: 55, lng: 10,
      geoPrecision: 'exact' as const, recurrence: null, openingNotes: null, imageUrls: [],
      lastSeenAt: '2026-07-10', lastVerifiedAt: null,
    };
    expect(computeInformalConfidence(input, TODAY)).toEqual(computeInformalConfidence(input, TODAY));
  });

  it('always returns a score inside 0..100 even with everything against it', () => {
    const r = computeInformalConfidence(
      {
        sources: [], visitReports: [visit({ reportedClosed: true }), visit({ reportedClosed: true })],
        street: null, phone: null, lat: null, lng: null, geoPrecision: 'unknown',
        recurrence: null, openingNotes: null, imageUrls: [], lastSeenAt: '2020-01-01',
        lastVerifiedAt: null,
        flags: { conflictingAddress: true, deadLink: true, unclearIfFlea: true, looksOneOff: true, probableDuplicate: true },
      },
      TODAY,
    );
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(100);
  });
});

// ===========================================================================
// FUND SCORE — "is it worth the drive?" — and CRUCIALLY, independent of the above
// ===========================================================================
describe('computeFundScore', () => {
  it('rates an unsorted private dødsbo barn with few traces very highly', () => {
    const r = computeFundScore({
      placeType: 'doedsbo', inventorySignals: ['usorteret', 'blandet'], priceLevel: 'lav',
      visitReports: [visit({ negotiable: true, worthTheDrive: true })], websiteUrl: null,
      facebookUrl: 'https://facebook.com/x', kmToLargeCity: 40, status: 'sporadic', sourceCount: 1,
      flags: { notOnGoogleMaps: true, unsortedStock: true },
    });
    expect(r.score).toBeGreaterThanOrEqual(85);
    expect(r.summary).toMatch(/lovende/i);
  });

  it('rates a curated professional dealer with a webshop low', () => {
    const r = computeFundScore({
      placeType: 'andet', inventorySignals: ['dansk-design', 'antik'], priceLevel: 'hoej',
      visitReports: [visit({ sellerKind: 'professionel' })],
      websiteUrl: 'https://shop.dk', facebookUrl: null, kmToLargeCity: 2, status: 'active_online',
      sourceCount: 6,
      flags: { professionalDealer: true, curatedVintage: true, knownMarketPrices: true, hasWebshop: true, strongSocialPresence: true, individuallyPriced: true },
    });
    expect(r.score).toBeLessThan(30);
    expect(r.summary).toMatch(/næppe/i);
  });

  it('is INDEPENDENT of confidence — the high-fund place can be the least certain', () => {
    // One old anonymous post about an unsorted barn: low confidence, high fund.
    const conf = computeInformalConfidence(
      {
        sources: [src({ observedAt: '2025-10-01' })], visitReports: [], street: null, phone: null,
        lat: null, lng: null, geoPrecision: 'unknown', recurrence: null, openingNotes: null,
        imageUrls: [], lastSeenAt: '2025-10-01', lastVerifiedAt: null,
      },
      TODAY,
    );
    const fund = computeFundScore({
      placeType: 'loppelade', inventorySignals: ['usorteret'], priceLevel: 'lav',
      visitReports: [], websiteUrl: null, facebookUrl: null, kmToLargeCity: 50,
      status: 'sporadic', sourceCount: 1, flags: { notOnGoogleMaps: true },
    });
    // The whole thesis in two numbers: Radar-level certainty, tempting rummage.
    // (Thresholds are on the normalised scale — see FUND_SCALE.)
    expect(conf.score).toBeLessThan(45); // Radar territory
    expect(fund.score).toBeGreaterThan(60); // yet clearly worth a look
    expect(fund.score - conf.score).toBeGreaterThan(25); // and they diverge sharply
  });

  it('never promises — the wording stays hedged', () => {
    const r = computeFundScore({
      placeType: 'doedsbo', inventorySignals: ['usorteret'], priceLevel: 'lav', visitReports: [],
      websiteUrl: null, facebookUrl: null, kmToLargeCity: 60, status: 'sporadic', sourceCount: 1,
    });
    expect(r.summary).not.toMatch(/garanti|sikker|altid/i);
    expect(r.summary).toMatch(/ser .*lovende ud|måske/i);
  });

  it('explains itself — every score carries its reasons', () => {
    const r = computeFundScore({
      placeType: 'gaardsalg', inventorySignals: ['usorteret'], priceLevel: 'lav', visitReports: [],
      websiteUrl: null, facebookUrl: null, kmToLargeCity: 30, status: 'sporadic', sourceCount: 1,
    });
    expect(r.reasons.length).toBeGreaterThan(2);
    expect(r.reasons).toContain('Privat sælger, ikke forretning');
  });
});

// ===========================================================================
// TRUST LAYERS — Radar must never masquerade as a destination
// ===========================================================================
describe('trustLayerFor', () => {
  it('keeps an unverified place in Radar however tempting its fund score', () => {
    expect(trustLayerFor({ status: 'unverified', confidence: 90, callBeforeVisiting: false })).toBe('radar');
    expect(trustLayerFor({ status: 'recently_observed', confidence: 30, callBeforeVisiting: false })).toBe('radar');
  });

  it('routes ring-først and sporadic places to the check-first layer', () => {
    expect(trustLayerFor({ status: 'call_first', confidence: 80, callBeforeVisiting: true })).toBe('kontroller-foerst');
    expect(trustLayerFor({ status: 'sporadic', confidence: 80, callBeforeVisiting: false })).toBe('kontroller-foerst');
  });

  it('only calls a place dependable when it is confirmed AND well evidenced', () => {
    expect(trustLayerFor({ status: 'confirmed_active', confidence: 75, callBeforeVisiting: false })).toBe('bekraeftet');
    // Confirmed but thin evidence is not a destination.
    expect(trustLayerFor({ status: 'confirmed_active', confidence: 50, callBeforeVisiting: false })).toBe('kontroller-foerst');
  });

  it('never promotes a historical or rejected place', () => {
    expect(trustLayerFor({ status: 'historical', confidence: 95, callBeforeVisiting: false })).toBe('radar');
    expect(trustLayerFor({ status: 'rejected', confidence: 95, callBeforeVisiting: false })).toBe('radar');
  });
});
