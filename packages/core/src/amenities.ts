/**
 * Amenity extraction from Danish flea-market event descriptions.
 * Pure functions, no I/O.
 *
 * Trust principle: every facet is tri-state — true when mentioned positively,
 * false when explicitly negated ("ingen parkering", "toiletforhold findes
 * ikke"), null when not mentioned. We never guess.
 *
 * All patterns below are based on real phrasing harvested from crawled event
 * descriptions; representative originals are quoted in the comments.
 */

/** Practical facilities mentioned in an event description. */
export interface Amenities {
  parking: boolean | null;
  food: boolean | null;
  toilets: boolean | null;
  kidsActivities: boolean | null;
  accessibility: boolean | null;
  mobilepay: boolean | null;
  /**
   * true = cash is required ("kun kontant betaling", "medbring kontanter").
   * false = explicit evidence a non-cash method is accepted (a positive
   * MobilePay mention resolves cashOnly to false — "vi tager MobilePay og
   * kontanter" means cash is by definition not the only option).
   * null = no payment information at all.
   */
  cashOnly: boolean | null;
  weatherDependent: boolean | null;
  /** First URL adjacent to booking/stand-rental language, https-normalized. */
  bookingUrl: string | null;
  /** Derived: true when kidsActivities is true; otherwise null. */
  familyFriendly: boolean | null;
}

// JS \b is ASCII-only, so words starting with æ/ø/å never get a \b boundary.
// Use an explicit letter/digit lookbehind as the word-start guard instead.
const W = '(?<![a-zæøå0-9])';

// "Gratis parkering ved hallen", "Parkering uden beregning", "P-pladsen",
// "der findes parkeringsmuligheder i området", "OBS: Ingen parkering på Broens".
// Noun forms only — "må IKKE parkere på pladsen" is a stallholder instruction,
// not information about visitor parking, so verb forms are deliberately skipped.
const PARKING = new RegExp(`${W}(?:parkering[a-zæøå]*|p-plads[a-zæøå]*)`, 'g');

// "Madteltet sælger kræmmerpølser, flæskestegssandwich, kolde sodavand og fadøl",
// "lækre madboder", "foodtrucks", "kaffe på kanden", "øltelt, café, grillpølser
// og sildebord", "Mad kan købes på stedet", "Mad og drikke...".
// "café" is matched without the word-start guard so "cafeer"/"caféen" hit, and
// plain "mad" is NOT matched alone (too weak a signal).
const FOOD = new RegExp(
  `${W}(?:madbod[a-zæøå]*|madtelt[a-zæøå]*|food\\s?trucks?|foodtrucks?|kaffe[a-zæøå]*|grill[a-zæøå]*|pølse[a-zæøå]*|æbleskiver|mad og drikke|mad kan købes|salg af mad|spisesteder)|caf[ée][a-zæøå]*`,
  'g',
);

// "Der er toiletter, som man kan låne", "Fine toiletfaciliteter",
// "toiletmuligheder på Trianglen", "Offentligt toilet på torvet".
// "toiletpapir" is excluded — "tag en rulle toiletpapir under armen" is advice,
// not a facility.
const TOILETS = new RegExp(`${W}(?:toilet(?!papir)[a-zæøå]*|wc(?![a-zæøå0-9]))`, 'g');

// "Hoppeborge for små og større børn", "musik, mad, hoppeborge og en masse
// hyggelige aktiviteter for børn", "ansigtsmaling", "børneaktiviteter".
const KIDS_ACTIVITIES = new RegExp(
  `${W}(?:hoppeborg[a-zæøå]*|ansigtsmaling|børneaktivitet[a-zæøå]*|aktiviteter for (?:både )?børn)`,
  'g',
);

// "Hallen er handicapvenlig med masser af plads til kørestole og barnevogne",
// "Parkering uden beregning og handicapvenligt indendørs", "kørestolsvenligt".
const ACCESSIBILITY = new RegExp(
  `${W}(?:kørestolsvenlig[a-zæøå]*|handicapvenlig[a-zæøå]*|handicapadgang|handicaptoilet[a-zæøå]*|plads til kørestole)`,
  'g',
);

// "Der kan betales med kontanter eller mobilepay", "Betal nemt med MobilePay
// eller kontanter", "MobilePay (foretrukken) og kontanter". Also matches
// compounds like "mobilepaynummer" and "MobilePay-skilte".
const MOBILEPAY = new RegExp(`${W}mobile\\s?pay`, 'g');

// "kun kontant betaling", "kun mod kontant", "der kan kun betales kontant",
// "medbring kontanter", "husk at medbringe kontanter", "husk kontanter".
const CASH_ONLY = new RegExp(
  `${W}(?:(?:kun|udelukkende)\\s+(?:mod\\s+|betales\\s+|med\\s+)?kontant[a-zæøå]*|medbringe?\\s+kontanter|husk\\s+kontanter)`,
  'g',
);

// "Aflyses ved regn", "aflyser kun ved kraftig regn, tag evt en parasol med",
// "aflyse arrangementet i tilfælde af regn", "aflyses i tilfælde af dårligt
// vejr", "aflyst ved meget dårligt vejr eller anden force majeure".
// Negated spans carry "ikke" inside the match itself: "aflyser ikke i tilfælde
// af regn", "aflyses derfor ikke grundet regn", "aflyses ikke ved regn".
const WEATHER_CANCEL = /aflys[a-zæøå]*[^.!?\n]{0,45}?(?:regn|dårligt vejr)/g;

// Inverted order: "Ved regn aflyses loppemarkedet", "I tilfælde af dårligt
// vejr aflyses arrangementet".
const WEATHER_CANCEL_INVERTED =
  /(?:ved|i tilfælde af|grundet|pga\.?)\s[^.!?\n]{0,25}?(?:regn|dårligt vejr)[^.!?\n]{0,45}?aflys/g;

// "vejrforbehold", "kun i godt vejr" — unconditional positives (non-global:
// used with .test()).
const WEATHER_CONDITIONAL = /vejrforbehold|kun (?:i|ved) godt vejr/;

/** "ikke" as a standalone word inside a weather-cancellation span. */
const SPAN_IKKE = /(?<![a-zæøå])ikke(?![a-zæøå])/;

// Words that negate a facet mention appearing shortly after them:
// "ingen parkering", "der er IKKE toilet", "uden toiletter".
const NEGATORS = new Set(['ingen', 'ikke', 'uden']);

/** How many words before a mention we scan for a negator. Conservative. */
const NEGATION_WINDOW = 4;

// Clause boundaries reset the negation window, so "OBS: Ingen parkering på
// Broens – der findes parkeringsmuligheder i området" negates only the first
// clause. Spaced dashes only — "p-plads" must survive.
const CLAUSE_BOUNDARY = /[.!?\n;:]|[-–—]\s|\s[-–—]/;

// Trailing negation: "toiletforhold findes ikke", "toiletter er der ikke".
const TRAILING_NEGATION =
  /^[a-zæøå]*\s+(?:findes|forefindes|haves|er)(?:\s+der)?(?:\s+desværre)?\s+ikke(?![a-zæøå])/;

/** Booking-ish language marking a sentence as a booking context. */
const BOOKING_CONTEXT = /(?<![a-z0-9æøå])(?:book|tilmeld|lej|bestil|stade|stand)/i;

// First URL in a booking sentence. Alternatives, in scan order: full URLs
// ("https://sif-fodbold.nemtilmeld.dk/81/", "www.gentofteloppemarked.dk"),
// then bare domains after booking keywords ("Book på ksmarked.dk", "tilmeld
// dig på hadstenkulturhus.dk", "book din stand via boerneloppen.dk/book").
// The bare-domain lookbehind also blocks "-" and "." so an email like
// "jul@two-socks.com" cannot re-match from inside its own local/domain part.
const BOOKING_URL =
  /(?:https?:\/\/|www\.)[^\s"'<>()]+|(?<![@\w.-])[a-z0-9æøå][a-z0-9æøå-]*(?:\.[a-z0-9æøå-]+)*\.(?:dk|com|net|org|nu|eu|gle|info)\b(?:\/[^\s"'<>()]*)?/i;

// Sentence split that survives URLs (dots inside URLs are not followed by
// whitespace) and common abbreviations ("kl. 10", "ca. 50 stande",
// "195 DKK (ekskl. billetgebyr)").
const SENTENCE_SPLIT =
  /(?<!(?:^|[^a-zæøå])(?:kl|ca|evt|nr|tlf|bl\.a|ekskl|inkl))(?<=[a-zæøå])[.!?](?=\s)|\n+/i;

/** Was the mention at [start, end) explicitly negated? */
function isNegated(lower: string, start: number, end: number): boolean {
  const lookback = lower.slice(Math.max(0, start - 48), start);
  const clauses = lookback.split(CLAUSE_BOUNDARY);
  const clause = clauses[clauses.length - 1] ?? '';
  const words = clause.split(/[^a-zæøå]+/).filter((w) => w.length > 0);
  if (words.slice(-NEGATION_WINDOW).some((w) => NEGATORS.has(w))) return true;
  return TRAILING_NEGATION.test(lower.slice(end, end + 40));
}

/**
 * Tri-state facet detection: scan every mention; any non-negated mention wins
 * (a positive re-affirmation beats a negation elsewhere in the same text),
 * only-negated mentions give false, no mention gives null.
 */
function detectFacet(lower: string, pattern: RegExp): boolean | null {
  let sawNegated = false;
  for (const m of lower.matchAll(pattern)) {
    if (isNegated(lower, m.index, m.index + m[0].length)) sawNegated = true;
    else return true;
  }
  return sawNegated ? false : null;
}

/**
 * Weather dependence carries its negation mid-phrase ("aflyses ikke ved
 * regn"), so it checks the matched span for "ikke" instead of the window.
 */
function detectWeatherDependent(lower: string): boolean | null {
  if (WEATHER_CONDITIONAL.test(lower)) return true;
  let sawNegated = false;
  for (const pattern of [WEATHER_CANCEL, WEATHER_CANCEL_INVERTED]) {
    for (const m of lower.matchAll(pattern)) {
      if (SPAN_IKKE.test(m[0])) sawNegated = true;
      else return true;
    }
  }
  return sawNegated ? false : null;
}

/** Prefix https:// on schemeless URLs and strip trailing punctuation. */
function normalizeUrl(raw: string): string {
  const trimmed = raw.replace(/[.,;:!?»«"'“”‘’…]+$/, '');
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

/**
 * First URL in the first sentence containing booking/stand-rental language:
 * "Book din stand her: https://sif-fodbold.nemtilmeld.dk/81/",
 * "Tilmelding af loppestand via linket her: https://forms.gle/zxSP45ieXT4XvsA78",
 * "Book din stadeplads og læs mere her: https://vestamager.dk/marked/".
 */
function extractBookingUrl(text: string): string | null {
  for (const sentence of text.split(SENTENCE_SPLIT)) {
    if (sentence === undefined || !BOOKING_CONTEXT.test(sentence)) continue;
    const m = sentence.match(BOOKING_URL);
    if (m) return normalizeUrl(m[0]);
  }
  return null;
}

const EMPTY: Amenities = {
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
};

/** Extract practical amenity info from a Danish event description. */
export function extractAmenities(text: string | null | undefined): Amenities {
  if (!text || text.trim() === '') return { ...EMPTY };
  const lower = text.toLowerCase();

  const mobilepay = detectFacet(lower, MOBILEPAY);
  const cashOnlyRaw = detectFacet(lower, CASH_ONLY);
  // Explicit "cash only" wins; otherwise an accepted non-cash method proves
  // cash is not the only option; otherwise we know nothing.
  const cashOnly = cashOnlyRaw !== null ? cashOnlyRaw : mobilepay === true ? false : null;

  const kidsActivities = detectFacet(lower, KIDS_ACTIVITIES);

  return {
    parking: detectFacet(lower, PARKING),
    food: detectFacet(lower, FOOD),
    toilets: detectFacet(lower, TOILETS),
    kidsActivities,
    accessibility: detectFacet(lower, ACCESSIBILITY),
    mobilepay,
    cashOnly,
    weatherDependent: detectWeatherDependent(lower),
    bookingUrl: extractBookingUrl(text),
    familyFriendly: kidsActivities === true ? true : null,
  };
}
