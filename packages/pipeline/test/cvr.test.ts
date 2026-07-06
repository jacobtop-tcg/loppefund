import { describe, expect, it } from 'vitest';
import {
  parseCvrVirksomhed,
  fetchCvrSecondhandVenues,
  parseCvrDevVirksomhed,
  fetchCvrDevVenues,
} from '../src/adapters/cvr.ts';

const active = {
  cvrNummer: 12345678,
  virksomhedMetadata: {
    nyesteNavn: { navn: 'Genbrugsbutikken Rudkøbing' },
    nyesteBeliggenhedsadresse: {
      vejnavn: 'Ramsherred',
      husnummerFra: 12,
      bogstavFra: 'A',
      postnummer: 5900,
      postdistrikt: 'Rudkøbing',
    },
    nyesteHovedbranche: { branchekode: '477900', branchetekst: 'Detailhandel med brugte varer i forretninger' },
    sammensatStatus: 'NORMAL',
  },
};

describe('parseCvrVirksomhed', () => {
  it('maps an active second-hand company to a genbrug venue', () => {
    expect(parseCvrVirksomhed(active)).toMatchObject({
      sourceType: 'cvr',
      operatorToken: 'cvr',
      category: 'genbrug',
      title: 'Genbrugsbutikken Rudkøbing',
      street: 'Ramsherred 12A',
      postcode: '5900',
      city: 'Rudkøbing',
      openingHoursText: null,
    });
  });
  it('skips a closed (ophørt) company', () => {
    const closed = { ...active, virksomhedMetadata: { ...active.virksomhedMetadata, sammensatStatus: 'OPHØRT' } };
    expect(parseCvrVirksomhed(closed)).toBeNull();
  });
  it('skips a company with no usable address', () => {
    const noaddr = { ...active, virksomhedMetadata: { ...active.virksomhedMetadata, nyesteBeliggenhedsadresse: undefined } };
    expect(parseCvrVirksomhed(noaddr)).toBeNull();
  });
});

describe('parseCvrDevVirksomhed (cvr.dev single-string address)', () => {
  it('parses navn + "Vej 12, 5900 Rudkøbing" into a genbrug venue', () => {
    expect(
      parseCvrDevVirksomhed({
        navn: 'Rudkøbing Genbrug',
        cvr_nummer: 87654321,
        status: 'NORMAL',
        adresse: 'Ramsherred 12, 5900 Rudkøbing',
      }),
    ).toMatchObject({
      sourceType: 'cvr', category: 'genbrug', title: 'Rudkøbing Genbrug',
      street: 'Ramsherred 12', postcode: '5900', city: 'Rudkøbing',
    });
  });
  it('skips a ceased (ophørt/konkurs) company', () => {
    expect(parseCvrDevVirksomhed({ navn: 'X', status: 'OPHØRT', adresse: 'Vej 1, 1000 København' })).toBeNull();
  });
  it('skips an unparseable address', () => {
    expect(parseCvrDevVirksomhed({ navn: 'X', status: 'NORMAL', adresse: 'Grønland' })).toBeNull();
  });
});

describe('fetchCvrDevVenues', () => {
  it('no-ops without a key, and paginates + parses with one (injected fetch)', async () => {
    expect(await fetchCvrDevVenues({ apiKey: undefined })).toEqual([]);
    const pages = [
      { virksomheder: [{ navn: 'A Genbrug', cvr_nummer: 1, status: 'NORMAL', adresse: 'Vej 1, 8000 Aarhus C' }], pagination_token: 42 },
      { virksomheder: [{ navn: 'B Loppe', cvr_nummer: 2, status: 'NORMAL', adresse: 'Gade 2, 5000 Odense C' }] },
    ];
    let i = 0;
    const v = await fetchCvrDevVenues({ apiKey: 'k', fetchJson: async () => pages[i++]! });
    expect(v.map((x) => x.title)).toEqual(['A Genbrug', 'B Loppe']);
  });
});

describe('fetchCvrSecondhandVenues', () => {
  it('is a safe no-op when no credential is configured', async () => {
    expect(await fetchCvrSecondhandVenues({ user: undefined, pass: undefined })).toEqual([]);
  });
  it('scrolls pages and parses hits when credentials are provided (injected fetch)', async () => {
    const pages = [
      { hits: [{ _source: { Vrvirksomhed: active } }], scrollId: 's1' },
      { hits: [], scrollId: 's1' },
    ];
    let call = 0;
    const v = await fetchCvrSecondhandVenues({
      user: 'u',
      pass: 'p',
      fetchPage: async () => pages[call++]!,
    });
    expect(v).toHaveLength(1);
    expect(v[0]!.title).toBe('Genbrugsbutikken Rudkøbing');
  });
});
