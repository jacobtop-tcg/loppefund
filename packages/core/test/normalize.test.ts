import { describe, expect, it } from 'vitest';
import { cleanCity, cleanStreet, cleanVenueName, stripDateTokens } from '../src/normalize.ts';

describe('cleanVenueName', () => {
  it('keeps a short place label', () => {
    expect(cleanVenueName('Sankt Nicolai Apotek')).toBe('Sankt Nicolai Apotek');
  });
  it('rejects a prose paragraph', () => {
    expect(
      cleanVenueName(
        'Du kører ad hovedvejen mod Farum. Ved rundkørslen tager du første afgang. Herefter fortsætter du 2 km og drejer til højre ved kirken.',
      ),
    ).toBeNull();
  });
  it('handles null', () => {
    expect(cleanVenueName(null)).toBeNull();
  });
});

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

  it('strips a venue "på ..." descriptor and a dangling period from the city', () => {
    expect(cleanCity('Lyngby på Johannes Fogs Plads.', '2800')).toBe('Lyngby');
    expect(cleanCity('2800 Lyngby på Johannes Fogs Plads', '2800')).toBe('Lyngby');
    expect(cleanCity('Ballerup.', '2750')).toBe('Ballerup');
  });

  it('handles null/empty', () => {
    expect(cleanCity(null)).toBeNull();
    expect(cleanCity('', '5000')).toBeNull();
  });
});

describe('cleanStreet', () => {
  it('nulls vague-locality placeholders', () => {
    expect(cleanStreet('Byens gader')).toBeNull();
    expect(cleanStreet('byens gader.')).toBeNull();
    expect(cleanStreet('Hele byen')).toBeNull();
    expect(cleanStreet('Flere steder i byen')).toBeNull();
    expect(cleanStreet(null)).toBeNull();
    expect(cleanStreet('  ')).toBeNull();
  });

  it('keeps a real address or named square untouched', () => {
    expect(cleanStreet('Søndergade 12')).toBe('Søndergade 12');
    expect(cleanStreet('Torvet')).toBe('Torvet');
    expect(cleanStreet('Svanetorvet')).toBe('Svanetorvet');
  });
});

import { inferIndoorOutdoor } from '../src/normalize.ts';

describe('inferIndoorOutdoor (free-text, precision-first)', () => {
  it('infers indoor from unambiguous venue words', () => {
    expect(inferIndoorOutdoor('Loppemarked i Vestergadehallen')).toBe('indoor');
    expect(inferIndoorOutdoor('Kræmmermarked på Arena Randers')).toBe('indoor');
    expect(inferIndoorOutdoor('Loppemarked i Egå Forsamlingshus')).toBe('indoor');
    expect(inferIndoorOutdoor('Stort indendørs loppemarked')).toBe('indoor');
  });

  it('infers outdoor from unambiguous open-ground words', () => {
    expect(inferIndoorOutdoor('Udendørs loppemarked på torvet')).toBe('outdoor');
    expect(inferIndoorOutdoor('Bagagerumsmarked på Cirkuspladsen')).toBe('outdoor');
    expect(inferIndoorOutdoor('Kræmmermarked på boldbanen')).toBe('outdoor');
    expect(inferIndoorOutdoor('Loppemarked under åben himmel')).toBe('outdoor');
  });

  it('infers mixed only when both are stated', () => {
    expect(inferIndoorOutdoor('Loppemarked både indendørs og udendørs')).toBe('mixed');
  });

  it('does NOT misread the prepositions "inden"/"uden" as indoor/outdoor', () => {
    // The classic trap: "inden" = before, "uden" = without. Free prose is full of
    // them, so a market in a park must stay unknown, not become indoor/outdoor.
    expect(inferIndoorOutdoor('Loppemarked i Fælledparken. Kom inden kl. 15!')).toBe('unknown');
    expect(inferIndoorOutdoor('Gratis loppemarked uden beregning på Rådhuspladsen')).toBe('unknown');
    expect(inferIndoorOutdoor('Loppemarked på havnen')).toBe('unknown');
  });

  it('does NOT treat a parking mention as an outdoor venue', () => {
    // "gratis parkeringsplads" is the parking amenity, not the market floor.
    expect(inferIndoorOutdoor('Loppemarked i hallen. Gratis parkeringsplads ved indgangen.')).toBe(
      'indoor',
    );
  });

  it('returns unknown for empty or signal-free text', () => {
    expect(inferIndoorOutdoor(undefined)).toBe('unknown');
    expect(inferIndoorOutdoor('Loppemarked i Odense')).toBe('unknown');
  });
});

import { extractStallCountText } from '../src/normalize.ts';

describe('extractStallCountText', () => {
  it('extracts a stall count bound to a stall/vendor noun', () => {
    expect(extractStallCountText('med hele 216 stande fyldt til randen')).toBe('216 stande');
    expect(extractStallCountText('Loppemarkeder med op til 150 stader.')).toBe('150 stader');
    expect(extractStallCountText('78 stande a 3 x 3 meter')).toBe('78 stande');
    expect(extractStallCountText('i alt 100 stadepladser.')).toBe('100 stadepladser');
    expect(extractStallCountText('op mod 350 udstillere')).toBe('350 udstillere');
    expect(extractStallCountText('der er 40 boder, gratis adgang')).toBe('40 boder');
  });

  it('normalizes a range to an en-dash', () => {
    expect(extractStallCountText('ca. 15-20 stande')).toBe('15–20 stande');
  });

  it('ignores "pladser" — as often parking as stalls', () => {
    expect(extractStallCountText('50 pladser')).toBeNull();
    expect(extractStallCountText('gratis parkering, 200 pladser')).toBeNull();
  });

  it('does not mistake prices, times or stray numbers for stalls', () => {
    expect(extractStallCountText('entré 50 kr for voksne')).toBeNull();
    expect(extractStallCountText('åbent kl. 10 til 16')).toBeNull();
    expect(extractStallCountText('Loppemarked på havnen')).toBeNull();
    expect(extractStallCountText(null)).toBeNull();
  });

  it('rejects an implausibly small count', () => {
    expect(extractStallCountText('2 stande')).toBeNull();
  });
});
