import { describe, expect, it } from 'vitest';
import { parseCvrVirksomhed, fetchCvrSecondhandVenues } from '../src/adapters/cvr.ts';

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
