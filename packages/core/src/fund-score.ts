/**
 * FUND SCORE — "how likely am I to make a real find here?"
 *
 * Deliberately independent of confidence (informal-confidence.ts). Those two
 * questions pull in OPPOSITE directions, which is the whole insight of this
 * product: the places most likely to hide a bargain are exactly the ones with
 * the thinnest paper trail. A dødsbo barn known from one blurry Facebook post
 * is high-fund / low-confidence. A curated design dealer with a webshop and
 * 12k Instagram followers is high-confidence / low-fund. Blending them would
 * average away both signals.
 *
 * It is also NOT isHiddenGem (gems.ts). That heuristic is for dated markets and
 * is structurally unusable here: it gates on confidence >= 0.7 — unreachable for
 * a tip-sourced place, since the event model caps a lone low-trust source at
 * 0.44 — and it requires sourceCount === 1 exactly, so corroborating a place
 * would REMOVE its badge. Same spirit (hard signals, documented weights), new
 * model.
 *
 * HONESTY RULE: this is an estimate of POTENTIAL, never a promise. The wording
 * it produces must stay hedged ("ser lovende ud"), and the score must be shown
 * with its reasons so a person can judge the reasoning rather than trust a
 * number. A high fund score on a low-confidence place must never be presented
 * as a destination — see trustLayerFor() in informal-place.ts.
 */
import type { InformalPlace, InformalPlaceType, InventorySignal, PriceLevel } from './informal-place.ts';
import type { InformalVisitReport } from './informal-place.ts';

// ---------------------------------------------------------------------------
// WEIGHTS — the entire model. Tune ONLY here.
// ---------------------------------------------------------------------------
export const FUND_W = {
  /** A private seller, not a trade — the core of the whole thesis. */
  privateSeller: 16,
  /** Estate clearance / moving-out / clear-out: unsorted, motivated to sell. */
  clearanceSale: 14,
  /** Stock described as unsorted (boxes, a barn, "alt skal væk"). */
  unsortedStock: 12,
  /** Barely any online trace — nobody has picked it over. */
  fewOnlineTraces: 10,
  /** Far from a big city. */
  ruralRemote: 8,
  /** Opens rarely/sporadically — stock accumulates between openings. */
  sporadicOpening: 7,
  /** No webshop. */
  noWebshop: 6,
  /** Not on Google Maps. */
  notOnGoogleMaps: 8,
  /** Reported low prices. */
  lowPrices: 12,
  /** Many mixed categories — a proper rummage. */
  mixedCategories: 8,
  /** Haggling possible. */
  negotiable: 6,
  /** Fresh stock keeps arriving. */
  freshStock: 8,
  /** Visitors report good finds. */
  goodFindsReported: 12,

  // --- negatives ---
  professionalDealer: -18,
  curatedVintage: -14,
  designFocused: -10,
  knownMarketPrices: -10,
  hasWebshop: -10,
  strongSocialPresence: -8,
  individuallyPriced: -8,
  touristArea: -6,
  manyProfessionalTraders: -8,
  highPrices: -14,
} as const;

const BASE = 30;

/** Place types that are private by their very nature. */
const PRIVATE_TYPES: ReadonlySet<InformalPlaceType> = new Set([
  'loppelade', 'gaardsalg', 'garagesalg', 'doedsbo', 'loppeskur', 'privat-saelger',
]);

/** Types whose stock is, by definition, a clear-out. */
const CLEARANCE_TYPES: ReadonlySet<InformalPlaceType> = new Set(['doedsbo']);

/** Categories that signal a curated/priced trade rather than a rummage. */
const CURATED_SIGNALS: ReadonlySet<InventorySignal> = new Set(['dansk-design', 'antik']);

export interface FundScoreInput {
  placeType: InformalPlaceType;
  inventorySignals: InventorySignal[];
  priceLevel: PriceLevel | null;
  visitReports: InformalVisitReport[];
  websiteUrl: string | null;
  facebookUrl: string | null;
  /** Distance to the nearest large city in km, when known. */
  kmToLargeCity: number | null;
  status: InformalPlace['status'];
  /** How many independent sources mention it — few traces = unpicked. */
  sourceCount: number;
  /** Reviewer/classifier flags for things we cannot infer from data. */
  flags?: {
    professionalDealer?: boolean;
    curatedVintage?: boolean;
    knownMarketPrices?: boolean;
    hasWebshop?: boolean;
    strongSocialPresence?: boolean;
    individuallyPriced?: boolean;
    touristArea?: boolean;
    manyProfessionalTraders?: boolean;
    notOnGoogleMaps?: boolean;
    unsortedStock?: boolean;
  };
}

export interface FundScoreResult {
  /** 0..100 — an estimate of potential, never a promise. */
  score: number;
  reasons: string[];
  summary: string;
}

/** Distance beyond which a place counts as pleasantly out of the way. */
export const RURAL_KM = 25;
/** At or under this many independent sources, a place is "barely known". */
export const FEW_TRACES_MAX = 2;

/**
 * The raw points a place could reach if EVERY positive signal fired at once
 * (BASE + all positives = 157). Measured, not guessed: without normalising by
 * it, the model saturates — the first real ingest produced 100/100 for BOTH a
 * verified barn and a one-tip dødsbo lager, i.e. a score that cannot rank.
 *
 * Scaling by the theoretical maximum keeps the point model transparent (each
 * weight still means what it says) while making the OUTPUT discriminate: a very
 * strong place lands in the 80s, a merely promising one in the 50s, and 100 is
 * reserved for something that genuinely ticks every box.
 */
export const FUND_SCALE =
  BASE +
  FUND_W.privateSeller + FUND_W.clearanceSale + FUND_W.unsortedStock +
  FUND_W.fewOnlineTraces + FUND_W.ruralRemote + FUND_W.sporadicOpening +
  FUND_W.noWebshop + FUND_W.notOnGoogleMaps + FUND_W.lowPrices +
  FUND_W.mixedCategories + FUND_W.negotiable + FUND_W.freshStock +
  FUND_W.goodFindsReported;


/**
 * How many visit reports it takes before a report-derived signal counts fully.
 *
 * One visitor is not nothing — refusing to hear them would throw away the only
 * first-hand evidence this dataset ever gets. But one visitor should not be able
 * to move the score as far as three can: "der kan forhandles" from a single good
 * afternoon is a mood, not a property of the place. So a lone report counts
 * HALF, and the reason says so out loud. Nothing is discarded; nothing is
 * over-trusted.
 *
 * Operator flags are unaffected — a human who has vetted the place is not a
 * sample of one.
 */
export const VISIT_QUORUM = 2;

/** 0 for no reports, 0.5 for a single one, 1 from the quorum up. */
function reportShare(n: number): number {
  if (n <= 0) return 0;
  return n >= VISIT_QUORUM ? 1 : 0.5;
}

/** "(3 besøg)" / "(kun 1 besøg — tæller halvt)" — the count is part of the claim. */
function visitNote(n: number): string {
  return n >= VISIT_QUORUM ? `(${n} besøg)` : '(kun 1 besøg — tæller halvt)';
}

export function computeFundScore(input: FundScoreInput): FundScoreResult {
  let score = BASE;
  const reasons: string[] = [];
  const f = input.flags ?? {};

  // --- positives ---
  if (PRIVATE_TYPES.has(input.placeType)) {
    score += FUND_W.privateSeller;
    reasons.push('Privat sælger, ikke forretning');
  }
  if (CLEARANCE_TYPES.has(input.placeType)) {
    score += FUND_W.clearanceSale;
    reasons.push('Dødsbo/oprydningssalg');
  }
  if (f.unsortedStock || input.inventorySignals.includes('usorteret')) {
    score += FUND_W.unsortedStock;
    reasons.push('Usorteret lager');
  }
  if (input.sourceCount <= FEW_TRACES_MAX) {
    score += FUND_W.fewOnlineTraces;
    reasons.push('Få online spor');
  }
  if (input.kmToLargeCity != null && input.kmToLargeCity >= RURAL_KM) {
    score += FUND_W.ruralRemote;
    reasons.push('Ligger langt fra de store byer');
  }
  if (input.status === 'sporadic' || input.status === 'call_first') {
    score += FUND_W.sporadicOpening;
    reasons.push('Sporadisk åbent — varer samler sig');
  }
  if (!input.websiteUrl && !f.hasWebshop) {
    score += FUND_W.noWebshop;
    reasons.push('Ingen webshop');
  }
  if (f.notOnGoogleMaps) {
    score += FUND_W.notOnGoogleMaps;
    reasons.push('Ikke på Google Maps');
  }

  // Price level: reported by visitors, so it beats any guess — but a single
  // visitor's guess is still a single visitor's guess. An operator-set level is
  // taken at full weight; a level derived from one report is halved.
  const reportedPrices = input.visitReports.map((r) => r.priceLevel).filter(Boolean) as PriceLevel[];
  const price = input.priceLevel ?? majority(reportedPrices);
  const priceShare = input.priceLevel ? 1 : reportShare(reportedPrices.length);
  const priceNote = input.priceLevel ? '' : ` ${visitNote(reportedPrices.length)}`;
  if (price === 'lav') {
    score += Math.round(FUND_W.lowPrices * priceShare);
    reasons.push(`Lave rapporterede priser${priceNote}`);
  } else if (price === 'hoej') {
    score += Math.round(FUND_W.highPrices * priceShare);
    reasons.push(`Høje rapporterede priser${priceNote}`);
  }

  const mixed = input.inventorySignals.length >= 4 || input.inventorySignals.includes('blandet');
  if (mixed) {
    score += FUND_W.mixedCategories;
    reasons.push('Mange blandede varekategorier');
  }
  const negotiable = input.visitReports.filter((r) => r.negotiable === true).length;
  if (negotiable > 0) {
    score += Math.round(FUND_W.negotiable * reportShare(negotiable));
    reasons.push(`Der kan forhandles ${visitNote(negotiable)}`);
  }
  const freshStock = input.visitReports.filter((r) => r.freshStock === true).length;
  if (freshStock > 0) {
    score += Math.round(FUND_W.freshStock * reportShare(freshStock));
    reasons.push(`Nye varer kommer til ${visitNote(freshStock)}`);
  }
  const goodFinds = input.visitReports.filter((r) => r.worthTheDrive === true).length;
  if (goodFinds > 0) {
    score += Math.round(FUND_W.goodFindsReported * reportShare(goodFinds));
    reasons.push(
      goodFinds >= VISIT_QUORUM
        ? `${goodFinds} besøgende anbefaler turen`
        : '1 besøgende anbefaler turen (tæller halvt)',
    );
  }

  // --- negatives ---
  // An operator who has vetted the place is not a sample of one, so their flag
  // lands at full weight. A lone visitor calling it professional is halved like
  // any other single report.
  const proReports = input.visitReports.filter((r) => r.sellerKind === 'professionel').length;
  const proShare = f.professionalDealer ? 1 : reportShare(proReports);
  if (proShare > 0) {
    score += Math.round(FUND_W.professionalDealer * proShare);
    reasons.push(
      f.professionalDealer ? 'Professionel handel' : `Professionel handel ${visitNote(proReports)}`,
    );
  }
  if (f.curatedVintage) {
    score += FUND_W.curatedVintage;
    reasons.push('Kurateret vintage');
  }
  if (input.inventorySignals.some((s) => CURATED_SIGNALS.has(s)) && !f.unsortedStock) {
    score += FUND_W.designFocused;
    reasons.push('Design-/antikfokus');
  }
  if (f.knownMarketPrices) {
    score += FUND_W.knownMarketPrices;
    reasons.push('Kender markedspriserne');
  }
  if (f.hasWebshop || input.websiteUrl) {
    score += FUND_W.hasWebshop;
    reasons.push('Har webshop/hjemmeside');
  }
  if (f.strongSocialPresence) {
    score += FUND_W.strongSocialPresence;
    reasons.push('Stor social tilstedeværelse');
  }
  if (f.individuallyPriced) {
    score += FUND_W.individuallyPriced;
    reasons.push('Alt er prissat enkeltvis');
  }
  if (f.touristArea) {
    score += FUND_W.touristArea;
    reasons.push('Turistområde');
  }
  if (f.manyProfessionalTraders) {
    score += FUND_W.manyProfessionalTraders;
    reasons.push('Mange professionelle kræmmere');
  }

  // Normalise against the theoretical maximum so the score RANKS instead of
  // saturating (see FUND_SCALE). Negatives can push below zero; clamp both ends.
  const scaled = Math.round((score / FUND_SCALE) * 100);
  const clamped = Math.max(0, Math.min(100, scaled));
  return { score: clamped, reasons, summary: summarize(clamped, reasons) };
}

function majority<T extends string>(xs: T[]): T | null {
  if (xs.length === 0) return null;
  const counts = new Map<T, number>();
  for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]![0];
}

/** Hedged on purpose — this is potential, not a promise. */
function summarize(score: number, reasons: string[]): string {
  const head = reasons.slice(0, 3).join(', ').toLowerCase();
  const band =
    score >= 80
      ? 'Ser meget lovende ud'
      : score >= 60
        ? 'Ser lovende ud'
        : score >= 40
          ? 'Måske et fund'
          : 'Næppe de store fund';
  return head ? `${band} — ${head}.` : band;
}
