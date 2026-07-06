import { describe, expect, it } from 'vitest';
import { danishHoursToOsm, splitPostcodeCity } from '../src/adapters/danish-hours.ts';
import { parseKraeftensHits } from '../src/adapters/kraeftensbekaempelse.ts';
import { parseDanmissionMarkers } from '../src/adapters/danmission.ts';
import { parseFrelsensHaer } from '../src/adapters/frelsenshaer.ts';

describe('danishHoursToOsm', () => {
  it('parses abbreviated and full day ranges, dot/colon times, and HH-only', () => {
    expect(danishHoursToOsm('Man-fre: 10.00-17.30\nLørdag: 10.00-14.00')).toBe(
      'Mo-Fr 10:00-17:30; Sa 10:00-14:00',
    );
    expect(danishHoursToOsm('Mandag - fredag 12.00-17.00<br />Lørdag 10.00-14.00')).toBe(
      'Mo-Fr 12:00-17:00; Sa 10:00-14:00',
    );
    expect(danishHoursToOsm('Mandag til lørdag 11-18, Søndag 12-17')).toBe(
      'Mo-Sa 11:00-18:00; Su 12:00-17:00',
    );
  });
  it('ignores prefix noise and closed days, returns null when nothing parses', () => {
    expect(danishHoursToOsm('Telefon: 12345678. Åbningstider: Søndag lukket')).toBeNull();
    expect(danishHoursToOsm('ring for aftale')).toBeNull();
  });
  it('splits "0000 By" into postcode + city', () => {
    expect(splitPostcodeCity('3460 Birkerød')).toEqual({ postcode: '3460', city: 'Birkerød' });
  });
});

describe('parseKraeftensHits', () => {
  it('maps a hit to a genbrug venue with hours; skips a null street', () => {
    const v = parseKraeftensHits([
      { title: 'Birkerød', street: 'Hovedgaden 39', city: '3460 Birkerød', daysOne: 'Man-fre:', timeSlotOne: '10.00-17.30', daysTwo: 'Lørdag:', timeSlotTwo: '10.00-14.00' },
      { title: 'Horsens', street: null, city: '8700 Horsens' },
    ]);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({
      sourceType: 'kb', operatorToken: 'kraeftens', category: 'genbrug',
      title: 'Kræftens Bekæmpelse Genbrug, Birkerød', street: 'Hovedgaden 39', postcode: '3460', city: 'Birkerød',
      openingHoursText: 'Mo-Fr 10:00-17:30; Sa 10:00-14:00',
    });
  });
});

describe('parseDanmissionMarkers', () => {
  it('keeps only /genbrugsbutik/ markers and reads coords + hours', () => {
    const v = parseDanmissionMarkers([
      { title: 'Danmission Genbrug Osted', address: 'Birkholmvej 2, 4320 Lejre', lat: '55.55', lng: '11.95', link: '/genbrugsbutik/osted/', description: '<p>Mandag - fredag 12.00-17.00<br />Lørdag 10.00-14.00</p>' },
      { title: 'Danmission i Tanzania', address: 'Tanzania', lat: '-6.3', lng: '34.8', link: '/arbejde/oestafrika/' },
    ]);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({
      sourceType: 'dm', operatorToken: 'danmission', street: 'Birkholmvej 2', postcode: '4320', city: 'Lejre',
      lat: 55.55, lng: 11.95, openingHoursText: 'Mo-Fr 12:00-17:00; Sa 10:00-14:00',
    });
  });
});

describe('parseFrelsensHaer', () => {
  it('parses the Viamap allDatasets GeoJSON blob (coords + address)', () => {
    const feats = [{ type: 'Feature', geometry: { type: 'Point', coordinates: [8.479, 55.487] }, properties: { div1: 'Esbjerg', div2: 'Ravnevej 2, 6705 Esbjerg Ø' } }];
    const html = `<script>var allDatasets = JSON.parse(JSON.stringify([{"data": ${JSON.stringify(feats)}}]))</script>`;
    const v = parseFrelsensHaer(html);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({
      sourceType: 'fh', operatorToken: 'frelsens haer', title: 'Frelsens Hær Genbrug, Esbjerg',
      street: 'Ravnevej 2', postcode: '6705', city: 'Esbjerg Ø', lat: 55.487, lng: 8.479,
    });
  });
  it('returns nothing when the blob is absent', () => {
    expect(parseFrelsensHaer('<html></html>')).toEqual([]);
  });
});
