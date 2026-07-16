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

  // Price level: reported by visitors, so it beats any guess.
  const reportedPrices = input.visitReports.map((r) => r.priceLevel).filter(Boolean) as PriceLevel[];
  const price = input.priceLevel ?? majority(reportedPrices);
  if (price === 'lav') {
    score += FUND_W.lowPrices;
    reasons.push('Lave rapporterede priser');
  } else if (price === 'hoej') {
    score += FUND_W.highPrices;
    reasons.push('Høje rapporterede priser');
  }

  const mixed = input.inventorySignals.length >= 4 || input.inventorySignals.includes('blandet');
  if (mixed) {
    score += FUND_W.mixedCategories;
    reasons.push('Mange blandede varekategorier');
  }
  if (input.visitReports.some((r) => r.negotiable === true)) {
    score += FUND_W.negotiable;
    reasons.push('Der kan forhandles');
  }
  if (input.visitReports.some((r) => r.freshStock === true)) {
    score += FUND_W.freshStock;
    reasons.push('Nye varer kommer til');
  }
  const goodFinds = input.visitReports.filter((r) => r.worthTheDrive === true).length;
  if (goodFinds > 0) {
    score += FUND_W.goodFindsReported;
    reasons.push(`${goodFinds} besøgende anbefaler turen`);
  }

  // --- negatives ---
  const professional =
    f.professionalDealer || input.visitReports.some((r) => r.sellerKind === 'professionel');
  if (professional) {
    score += FUND_W.professionalDealer;
    reasons.push('Professionel handel');
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

  const clamped = Math.max(0, Math.min(100, Math.round(score)));
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
