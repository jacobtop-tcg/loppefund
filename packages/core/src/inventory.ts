/**
 * What a market SAYS it has, extracted from its Danish description.
 *
 * Pure functions, no I/O. Same shape and the same discipline as amenities.ts,
 * and the same refusal: we never guess.
 *
 * THIS IS A "MENTIONS" EXTRACTOR, NOT A "HAS" EXTRACTOR — and the distinction
 * is the whole design. 37% of the 739 markets mention at least one interest in
 * their text; the other 63% are silent, and silence is not absence. A market
 * that never writes "møbler" almost certainly still has some. So a signal here
 * means "the market advertises this", never "the market has this", and every
 * label in the UI must say so. Filtering on it narrows to markets that PROMISE
 * the thing — genuinely useful for a hunter, and honest about the rest.
 *
 * The vocabulary is the brief's 17 interests. Patterns are built from real
 * phrasing in the crawled corpus; representative originals are quoted below,
 * and the deliberate exclusions are the interesting part.
 */
import type { InventorySignal } from './informal-place.ts';

// JS \b is ASCII-only, so a word starting with æ/ø/å never gets a boundary.
// Same guard amenities.ts uses, for the same reason.
const W = '(?<![a-zæøå0-9])';

/** One interest and the Danish it is actually written in. */
interface Rule {
  signal: InventorySignal;
  re: RegExp;
}

const rules: Array<[InventorySignal, string]> = [
  // "gamle møbler", "møbler, lamper og bohave", "teakmøbler".
  // DELIBERATELY NOT "bord": at a flea market a "bord" is nearly always a STALL
  // — "book et bord", "borde kan lejes", "pris pr. bord 150 kr" — so matching it
  // would tag half the corpus as furniture. "stol" is out for the same reason
  // (café seating, stallholder chairs). We lose real furniture mentions; we do
  // not invent any.
  ['moebler', `${W}(?:møbl[a-zæøå]*|sofa[a-zæøå]*|reol[a-zæøå]*|kommode[a-zæøå]*|skænk[a-zæøå]*|chatol[a-zæøå]*)`],

  // "dansk design", "Wegner-stole", "Kaare Klint". Designer names are the only
  // reliable signal — "design" alone appears in "designet af" and every second
  // marketing sentence.
  ['dansk-design', `${W}(?:dansk design|wegner|finn juhl|arne jacobsen|panton|kaare klint|fritz hansen|børge mogensen|poul henningsen|louis poulsen)`],

  ['keramik', `${W}(?:keramik[a-zæøå]*|stentøj[a-zæøå]*|lertøj[a-zæøå]*)`],

  // "Royal Copenhagen", "Bing & Grøndahl", "porcelæn og stel".
  ['porcelaen', `${W}(?:porcelæn[a-zæøå]*|royal copenhagen|bing\\s*&?\\s*grøndahl|musselmalet)`],

  // "glaskunst", "Holmegaard". NOT bare "glas": "glasskår", "glasdør",
  // "solbriller med glas" — and "et glas vin" in the café sentence.
  ['glas', `${W}(?:glaskunst[a-zæøå]*|holmegaard|kastrup glas|glasvarer)`],

  // "vinyl", "LP'er", "grammofonplader". NOT bare "plader" — the corpus has
  // gipsplader, plader til taget, plader (paving). "plader" only counts when it
  // is glued to a music word.
  ['vinyl', `${W}(?:vinyl[a-zæøå]*|lp'?er|lp-plader|grammofon[a-zæøå]*|singler|cd'?er)`],

  ['lego', `${W}(?:lego[a-zæøå]*|duplo[a-zæøå]*|playmobil)`],

  // "legetøj", "bamser", "BRIO-tog", "dukker og dukkehus".
  ['legetoej', `${W}(?:legetøj[a-zæøå]*|bamse[a-zæøå]*|brio|dukke(?!rt)[a-zæøå]*|spil og puslespil)`],

  // "værktøj", "haveredskaber". NOT "maskiner" alone — "kaffemaskine",
  // "symaskine", "maskinen der laver pandekager" all appear.
  ['vaerktoej', `${W}(?:værktøj[a-zæøå]*|haveredskab[a-zæøå]*|el-værktøj)`],

  // "gammel radio", "stereoanlæg", "retroelektronik". NOT "elektrisk".
  ['elektronik', `${W}(?:elektronik[a-zæøå]*|stereoanlæg[a-zæøå]*|højttaler[a-zæøå]*|pladespiller[a-zæøå]*|radioer)`],

  // "bøger", "tegneserier". NOT bare "bog": "bogen om…", "efter bogen",
  // "Facebook" (guarded by W, but let's be explicit) — plural only.
  ['boeger', `${W}(?:bøger[a-zæøå]*|boghandel|tegneserie[a-zæøå]*|antikvariat[a-zæøå]*)`],

  // "tøj og sko", "børnetøj", "beklædning". NOT "tøjbutik" alone? No — a market
  // saying "tøjbutik" is telling us there is clothing. Kept.
  ['toej', `${W}(?:tøj(?!container)[a-zæøå]*|beklædning[a-zæøå]*|kjole[a-zæøå]*|sko(?:ene|ene)?(?![a-zæøå]))`],

  // "smykker", "sølvtøj", "gamle ure".
  ['smykker', `${W}(?:smykke[a-zæøå]*|sølvtøj[a-zæøå]*|armbånd[a-zæøå]*|ure(?![a-zæøå]))`],

  // "samlerobjekter", "frimærker", "mønter". NOT "samler" alone — "vi samler
  // ind til", "samler støv" are everywhere.
  ['samlerobjekter', `${W}(?:samlerobjekt[a-zæøå]*|samlermarked|frimærke[a-zæøå]*|mønter(?![a-zæøå]))`],

  ['cykler', `${W}(?:cykler(?![a-zæøå])|cykelmarked|cykeldele)`],

  ['retro', `${W}(?:retro[a-zæøå]*|vintage[a-zæøå]*|50'?er|60'?er|70'?er)`],

  ['antik', `${W}(?:antik(?!vitetshandel)[a-zæøå]*|antikvitet[a-zæøå]*)`],
];

const RULES: Rule[] = rules.map(([signal, src]) => ({ signal, re: new RegExp(src, 'i') }));

/**
 * The interests a market's own text advertises, deduped and in a stable order.
 *
 * Returns [] when the text says nothing about goods — which is the common case
 * (63% of the corpus) and means "we don't know", NOT "nothing here".
 */
export function extractInventorySignals(text: string | null | undefined): InventorySignal[] {
  if (!text) return [];
  const t = text.toLowerCase();
  const out: InventorySignal[] = [];
  for (const r of RULES) {
    if (r.re.test(t) && !out.includes(r.signal)) out.push(r.signal);
  }
  return out;
}
