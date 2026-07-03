import { describe, expect, it } from 'vitest';
import { cleanCity, stripDateTokens } from '../src/normalize.ts';

describe('stripDateTokens', () => {
  it('strips a trailing weekday + date + year', () => {
    expect(stripDateTokens('Loppemarked lørdag d. 4. juli 2026')).toBe('Loppemarked');
    expect(stripDateTokens('Flagstang Loppemarked i Mølleparken lørdag d. 15. august')).toBe(
      'Flagstang Loppemarked i Mølleparken',
    );
  });

  it('strips a mid-title date fragment', () => {
    expect(stripDateTokens('Johannes Fogs plads loppemarked 11 april v. Magasin i Lyngby')).toBe(
      'Johannes Fogs plads loppemarked v. Magasin i Lyngby',
    );
  });

  it('strips a trailing "d. N. month"', () => {
    expect(stripDateTokens('VBC Julemarked – Julehygge for hele familien d. 14. november')).toBe(
      'VBC Julemarked – Julehygge for hele familien',
    );
    expect(stripDateTokens('Loppemarked Halmtorvet 16. august')).toBe('Loppemarked Halmtorvet');
  });

  it('leaves a clean title untouched', () => {
    expect(stripDateTokens('Loppemarked på Nørrebro')).toBe('Loppemarked på Nørrebro');
    expect(stripDateTokens('VBC Julemarked')).toBe('VBC Julemarked');
  });

  it('keeps the original if stripping would leave nothing', () => {
    expect(stripDateTokens('Lørdag d. 4. juli')).toBe('Lørdag d. 4. juli');
  });
});

describe('cleanCity', () => {
  it('strips a leading postcode to a plain town', () => {
    expect(cleanCity('4070 Kirke Hyllinge', '4070')).toBe('Kirke Hyllinge');
  });

  it('de-duplicates a repeated "postcode city" cram', () => {
    expect(cleanCity(', 6640 Lunderskov, 6640 Lunderskov, 6640 Lunderskov', '6640')).toBe('Lunderskov');
  });

  it('drops a street segment that leaked into city, keeping the postcode town', () => {
    expect(cleanCity('Kastaniehøjvej 6, 8600 Silkeborg', '8600')).toBe('Silkeborg');
    expect(cleanCity('Hou Havn, 8300 Odder', '8300')).toBe('Odder');
  });

  it('leaves a clean city untouched', () => {
    expect(cleanCity('Svendborg', '5700')).toBe('Svendborg');
    expect(cleanCity('Aalborg SV', '9200')).toBe('Aalborg SV');
  });

  it('handles null/empty', () => {
    expect(cleanCity(null)).toBeNull();
    expect(cleanCity('', '5000')).toBeNull();
  });
});
