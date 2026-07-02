import { describe, expect, it } from 'vitest';
import { extractAmenities } from '../src/amenities.ts';

describe('extractAmenities — empty and silent input', () => {
  it('returns all null for null/undefined/empty text', () => {
    for (const input of [null, undefined, '', '   ']) {
      const a = extractAmenities(input);
      expect(a).toEqual({
        parking: null,
        food: null,
        toilets: null,
        kidsActivities: null,
        accessibility: null,
        mobilepay: null,
        cashOnly: null,
        weatherDependent: null,
        bookingUrl: null,
        familyFriendly: null,
      });
    }
  });

  it('never guesses: text mentioning no facets stays all null', () => {
    const a = extractAmenities(
      'Stort loppemarked med mange kræmmere, retro og vintage i hyggelige omgivelser.',
    );
    expect(Object.values(a).every((v) => v === null)).toBe(true);
  });
});

describe('extractAmenities — parking', () => {
  it('detects plain positive parking', () => {
    expect(extractAmenities('Gratis parkering lige ved hallen.').parking).toBe(true);
  });

  it('detects p-plads word forms', () => {
    expect(extractAmenities('Der er masser af p-pladser bag hallen.').parking).toBe(true);
  });

  it('negation: "uden parkering" gives false', () => {
    expect(extractAmenities('Pladsen er desværre uden parkering.').parking).toBe(false);
  });

  it('re-affirmed positive beats a negated first clause (real Broens text)', () => {
    const a = extractAmenities(
      'OBS: Ingen parkering på Broens – der findes parkeringsmuligheder i området.',
    );
    expect(a.parking).toBe(true);
  });
});

describe('extractAmenities — toilets', () => {
  it('detects positive toilets', () => {
    expect(extractAmenities('Der er toiletter, som man kan låne.').toilets).toBe(true);
  });

  it('negation: "ingen toiletter på pladsen" gives false', () => {
    expect(extractAmenities('Bemærk: ingen toiletter på pladsen.').toilets).toBe(false);
  });

  it('negation is case-insensitive: "der er IKKE toilet"', () => {
    expect(extractAmenities('Der er IKKE toilet på pladsen.').toilets).toBe(false);
  });

  it('trailing negation: "toiletforhold findes ikke"', () => {
    expect(extractAmenities('Toiletforhold findes ikke på markedet.').toilets).toBe(false);
  });

  it('does not read "toiletpapir" advice as a facility', () => {
    const a = extractAmenities(
      'Vi anbefaler, at man tager en rulle toiletpapir under armen inden man går hjemmefra.',
    );
    expect(a.toilets).toBe(null);
  });
});

describe('extractAmenities — food', () => {
  it('detects madboder and food trucks', () => {
    expect(extractAmenities('Lækre madboder og foodtrucks på pladsen.').food).toBe(true);
  });

  it('detects café / kaffe og kage', () => {
    expect(extractAmenities('I caféen kan man købe kaffe og kage.').food).toBe(true);
  });

  it('detects grill and pølser (real madtelt phrasing)', () => {
    const a = extractAmenities(
      'Madteltet sælger pølser, flæskestegssandwich, kolde sodavand og fadøl.',
    );
    expect(a.food).toBe(true);
  });
});

describe('extractAmenities — kids activities and familyFriendly', () => {
  it('hoppeborg og ansigtsmaling gives kidsActivities and derived familyFriendly', () => {
    const a = extractAmenities('Hoppeborg og ansigtsmaling til de mindste.');
    expect(a.kidsActivities).toBe(true);
    expect(a.familyFriendly).toBe(true);
  });

  it('detects "aktiviteter for både børn og voksne"', () => {
    const a = extractAmenities('Gratis aktiviteter for både børn og voksne.');
    expect(a.kidsActivities).toBe(true);
  });

  it('does not derive familyFriendly from food alone', () => {
    const a = extractAmenities('Der er kaffe og kage hele dagen.');
    expect(a.food).toBe(true);
    expect(a.familyFriendly).toBe(null);
  });
});

describe('extractAmenities — accessibility', () => {
  it('detects handicapvenlig with kørestole (real hall phrasing)', () => {
    const a = extractAmenities(
      'Hallen er handicapvenlig med masser af plads til kørestole og barnevogne.',
    );
    expect(a.accessibility).toBe(true);
  });

  it('detects kørestolsvenligt', () => {
    expect(extractAmenities('Markedet er kørestolsvenligt indendørs.').accessibility).toBe(true);
  });
});

describe('extractAmenities — payment', () => {
  it('"kun kontant betaling" gives cashOnly true and leaves mobilepay null', () => {
    const a = extractAmenities('Der er kun kontant betaling ved boderne.');
    expect(a.cashOnly).toBe(true);
    expect(a.mobilepay).toBe(null);
  });

  it('accepted MobilePay resolves cashOnly to false (documented semantic)', () => {
    const a = extractAmenities('Vi tager MobilePay og kontanter.');
    expect(a.mobilepay).toBe(true);
    expect(a.cashOnly).toBe(false);
  });

  it('detects mobilepay in real phrasing "betales med kontanter eller mobilepay"', () => {
    const a = extractAmenities('Ved boderne kan der betales med kontanter og MobilePay.');
    expect(a.mobilepay).toBe(true);
    expect(a.cashOnly).toBe(false);
  });

  it('negated mobilepay: "vi tager ikke imod MobilePay"', () => {
    expect(extractAmenities('Vi tager ikke imod MobilePay.').mobilepay).toBe(false);
  });

  it('"medbring kontanter" gives cashOnly true', () => {
    expect(extractAmenities('Husk at medbringe kontanter til loppefund.').cashOnly).toBe(true);
  });
});

describe('extractAmenities — weather dependence', () => {
  it('"aflyses ved regnvejr" gives true', () => {
    expect(extractAmenities('Markedet aflyses ved regnvejr.').weatherDependent).toBe(true);
  });

  it('real phrasing "aflyser kun ved kraftig regn" gives true', () => {
    const a = extractAmenities('Vi aflyser kun ved kraftig regn, tag evt en parasol med.');
    expect(a.weatherDependent).toBe(true);
  });

  it('inverted order "Ved regn aflyses loppemarkedet" gives true', () => {
    expect(extractAmenities('Ved regn aflyses loppemarkedet.').weatherDependent).toBe(true);
  });

  it('"vejrforbehold" and "kun i godt vejr" give true', () => {
    expect(extractAmenities('Der tages vejrforbehold.').weatherDependent).toBe(true);
    expect(extractAmenities('Markedet afholdes kun i godt vejr.').weatherDependent).toBe(true);
  });

  it('rain-proof markets are explicitly false (real phrasings)', () => {
    expect(
      extractAmenities('Vi aflyser ikke i tilfælde af regn, men du er velkommen til at medbringe en parasol.')
        .weatherDependent,
    ).toBe(false);
    expect(
      extractAmenities('Loppemarkedet er indendørs og aflyses derfor ikke grundet regn.')
        .weatherDependent,
    ).toBe(false);
  });

  it('unrelated rain talk stays null', () => {
    expect(
      extractAmenities('Bookingen kan ikke refunderes, heller ikke i tilfælde af dårligt vejr.')
        .weatherDependent,
    ).toBe(null);
  });
});

describe('extractAmenities — bookingUrl', () => {
  it('picks a full https URL in a booking sentence and strips trailing punctuation', () => {
    const a = extractAmenities('Book din stand her: https://sif-fodbold.nemtilmeld.dk/81/.');
    expect(a.bookingUrl).toBe('https://sif-fodbold.nemtilmeld.dk/81/');
  });

  it('prefixes https:// on www URLs (real Gentofte phrasing)', () => {
    const a = extractAmenities('Book din stand på www.gentofteloppemarked.dk.');
    expect(a.bookingUrl).toBe('https://www.gentofteloppemarked.dk');
  });

  it('handles bare domains with a path after booking keywords', () => {
    const a = extractAmenities(
      'Book din stand for 195 DKK lige her: madbillet.dk/show/event/broens-lopper16',
    );
    expect(a.bookingUrl).toBe('https://madbillet.dk/show/event/broens-lopper16');
  });

  it('survives "(ekskl. …)" between the booking keyword and the URL (verbatim live Broens text)', () => {
    const a = extractAmenities(
      'Book din stand for 195 DKK (ekskl. billetgebyr) lige her: madbillet.dk/show/event/broens-lopper16. \n En stand består af et 2 meter langt bord.',
    );
    expect(a.bookingUrl).toBe('https://madbillet.dk/show/event/broens-lopper16');
  });

  it('handles bare domains without a path (real "Book på ksmarked.dk")', () => {
    const a = extractAmenities('Ønsker du selv en stand? Book på ksmarked.dk.');
    expect(a.bookingUrl).toBe('https://ksmarked.dk');
  });

  it('does not mistake an email address for a bare booking domain (real corpus case)', () => {
    const a = extractAmenities('Kontakt jul@two-socks.com for at booke en stand.');
    expect(a.bookingUrl).toBe(null);
  });

  it('strips trailing curly quotes (real corpus case)', () => {
    const a = extractAmenities('Book en stand på “www.lilleaamarked.dk” under fanen tilmelding.');
    expect(a.bookingUrl).toBe('https://www.lilleaamarked.dk');
  });

  it('ignores URLs outside a booking context', () => {
    const a = extractAmenities('Se mere om markedet på www.eksempel.dk.');
    expect(a.bookingUrl).toBe(null);
  });

  it('picks the URL from the booking sentence, not an earlier sentence', () => {
    const a = extractAmenities(
      'Følg os på www.facebook.com/marked. Tilmelding her: https://www.hornbaekhus.com/aktivitet/loppemarked-2/2026-07-12/.',
    );
    expect(a.bookingUrl).toBe('https://www.hornbaekhus.com/aktivitet/loppemarked-2/2026-07-12/');
  });
});

describe('extractAmenities — composite real-world description', () => {
  it('extracts several facets from one realistic text', () => {
    const a = extractAmenities(
      'Der er gratis entré til markedet for publikum, gratis toiletter og gratis parkering ' +
        'lige ved markedspladsen. Madboder med kaffe og kage. Hoppeborge for små og større børn. ' +
        'Hallen er handicapvenlig. Der kan betales med kontanter eller MobilePay. ' +
        'Book din stadeplads og læs mere her: https://vestamager.dk/marked/',
    );
    expect(a).toEqual({
      parking: true,
      food: true,
      toilets: true,
      kidsActivities: true,
      accessibility: true,
      mobilepay: true,
      cashOnly: false,
      weatherDependent: null,
      bookingUrl: 'https://vestamager.dk/marked/',
      familyFriendly: true,
    });
  });
});
