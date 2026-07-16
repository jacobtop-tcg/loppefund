/**
 * TEXT CLASSIFICATION — what is this Danish post actually about?
 *
 * Deterministic and rule-based on purpose. The vocabulary of Danish flea posts
 * is small, stable and highly idiomatic ("flaget er ude", "alt skal væk",
 * "rydder dødsbo"), so rules read it accurately, run in the build for free, are
 * reproducible, and can be argued with line by line. An LLM here would add cost,
 * nondeterminism and a dependency for no accuracy we cannot already reach — and
 * the project rule is explicit: no LLM where deterministic logic suffices.
 *
 * The interface is deliberately model-shaped (text in, label + confidence +
 * evidence out) so a future ML/LLM classifier can be slotted behind it without
 * touching a caller.
 *
 * THE DISTINCTION THAT MATTERS MOST is `enkeltstaaende_privatsalg` vs
 * `informal_place`: "vi holder flyttesalg på lørdag" is a ONE-OFF and must never
 * become a permanent pin on a map, while "vi åbner laden igen" is a place with a
 * habit. Getting this wrong in the permissive direction fills the map with dead
 * addresses of private homes — the exact harm this whole design guards against.
 * So a one-off wins ties, and recurrence must be positively evidenced.
 */
import type { InformalPlaceType } from './informal-place.ts';

export type PostLabel =
  | 'loppemarked' // an ordinary (public) flea market — the existing event pipeline owns it
  | 'fast_genbrugssted' // a permanent shop — the venue layer owns it
  | 'informal_place' // a hidden/informal place with a habit — ours
  | 'enkeltstaaende_privatsalg' // a one-off private sale — NOT a place
  | 'doedsbosalg'
  | 'flyttesalg'
  | 'foreningsmarked'
  | 'professionel_antikhandel'
  | 'irrelevant'
  | 'mulig_dublet'
  | 'kraever_review';

export interface Classification {
  label: PostLabel;
  /** 0..1 — how sure the rules are. Low confidence routes to review. */
  confidence: number;
  /** The suggested place type when the label is a place-ish one. */
  placeType: InformalPlaceType | null;
  /** The exact phrases that drove the decision — always auditable. */
  evidence: string[];
  /** True when a human must look before anything is published. */
  needsReview: boolean;
}

const fold = (s: string): string =>
  s.toLowerCase().replaceAll('æ', 'ae').replaceAll('ø', 'oe').replaceAll('å', 'aa');

/** A phrase table. Every entry is a real Danish formulation, kept verbatim so a
 *  Dane can read this file and check it. */
interface Rule {
  /** Folded pattern. */
  re: RegExp;
  /** What the phrase says in plain Danish (shown as evidence). */
  says: string;
}

const rules = (pairs: Array<[RegExp, string]>): Rule[] => pairs.map(([re, says]) => ({ re, says }));

// --- a PLACE with a habit: the barn/shed/yard that keeps opening ---
const PLACE_HABIT = rules([
  [/\baabner laden\b|\baabner vi laden\b/, 'åbner laden'],
  [/\bnye ting i laden\b|\bnyt i laden\b/, 'nye ting i laden'],
  [/\bflaget er ude\b|\bnaar flaget er ude\b/, 'flaget er ude'],
  [/\bvi holder aabent igen\b|\baabent igen\b/, 'vi holder åbent igen'],
  [/\baabent paa gaarden\b|\bgaardsalg\b/, 'åbent på gården'],
  [/\blopper i garagen\b|\bgaragesalg\b/, 'lopper i garagen'],
  [/\bselvbetjent\b.{0,20}\b(loppeskur|skur|bod)\b|\bloppeskur\b/, 'selvbetjent loppeskur'],
  [/\bloppelade\b|\blade\b.{0,15}\blopper\b/, 'loppelade'],
  [/\baaben hal\b|\bprivat hal\b/, 'åben hal'],
  [/\bloppesalg paa adressen\b/, 'loppesalg på adressen'],
  [/\bstort privat loppesalg\b|\bprivat loppesalg\b/, 'privat loppesalg'],
  [/\bkom og goer et kup\b/, 'kom og gør et kup'],
  [/\bsamlersalg\b/, 'samlersalg'],
]);

// --- recurrence: the signal that separates a place from a one-off ---
const RECURRING = rules([
  [/\bhver (mandag|tirsdag|onsdag|torsdag|fredag|loerdag|soendag)\b/, 'hver ugedag'],
  [/\bhver weekend\b|\balle weekender\b/, 'hver weekend'],
  [/\bhver anden\b/, 'hver anden uge'],
  [/\bfoerste (loerdag|soendag)\b|\bsidste (loerdag|soendag)\b/, 'fast dag i måneden'],
  [/\baabent igen\b|\bigen i aar\b|\bsom altid\b/, 'åbner igen'],
  [/\bhele sommeren\b|\bhele sasonen\b|\bhele saesonen\b/, 'hele sæsonen'],
  [/\bfast\b.{0,10}\baabningstid/, 'faste åbningstider'],
]);

// --- one-off: everything must go, this weekend only ---
const ONE_OFF = rules([
  [/\balt skal vaek\b/, 'alt skal væk'],
  [/\bflyttesalg\b/, 'flyttesalg'],
  [/\boprydningssalg\b/, 'oprydningssalg'],
  [/\bbohave saelges\b|\bindbo saelges\b/, 'bohave/indbo sælges'],
  [/\bsidste (chance|dag|gang)\b/, 'sidste chance'],
  [/\blukker\b|\bophoerssalg\b/, 'lukker/ophørssalg'],
  [/\bkun i dag\b|\bkun paa loerdag\b|\benkelt dag\b/, 'kun én dag'],
]);

const DOEDSBO = rules([
  [/\bdoedsbo\b|\brydder doedsbo\b|\bdoedsbosalg\b/, 'dødsbo'],
  [/\bafdoede\b|\bafdoedes\b/, 'afdødes bo'],
]);

const FORENING = rules([
  [/\bforening\b|\bforenings(loppe|marked|salg)\b/, 'forening'],
  [/\bspejder\b|\bmenighed\b|\bkirke\b|\bborgerforening\b/, 'forening/kirke'],
  [/\bstoetter\b.{0,20}\b(projekt|forening|klub)\b/, 'støtter en forening'],
]);

const PROFESSIONAL = rules([
  [/\bantikvitetshandel\b|\bantikhandel\b|\bgalleri\b/, 'antikhandel'],
  [/\bwebshop\b|\bnetbutik\b|\bonline shop\b/, 'webshop'],
  [/\bcvr\b|\bmomsregistreret\b|\bfirma\b/, 'firma/CVR'],
  [/\bkurateret\b|\bnoeje udvalgt\b/, 'kurateret'],
  [/\bvi tilbyder vurdering\b|\bvurdering af doedsbo\b/, 'professionel vurdering'],
]);

const PERMANENT_SHOP = rules([
  [/\bgenbrugsbutik\b|\bgenbrugs butik\b/, 'genbrugsbutik'],
  [/\broede kors\b|\bkirkens korshaer\b|\bblaa kors\b|\bfrelsens haer\b/, 'velgørenhedskæde'],
  [/\baabningstider\b.{0,40}\bman(dag)?\b.{0,40}\bfre(dag)?\b/, 'faste hverdagsåbningstider'],
]);

const PUBLIC_MARKET = rules([
  [/\bkraemmermarked\b|\bstadeplads\b|\bstadeleje\b/, 'kræmmermarked/stadepladser'],
  [/\bbagagerumsmarked\b/, 'bagagerumsmarked'],
  [/\bloppemarked i\b.{0,30}\b(hallen|centret|idraetscenter|arena)\b/, 'marked i en hal'],
  [/\bentre\b.{0,15}\bkr\b/, 'entré'],
  // A named PUBLIC venue is a public market, whoever posts it.
  [/\bloppemarked (paa|i|ved)\b.{0,24}\b(torv|torvet|pladsen|havn|gymnasium|skole|hallen|stage)\b/, 'marked på offentligt sted'],
]);

/**
 * A scraped Facebook EVENT listing, recognised by its interface chrome rather
 * than its prose: "Sun, Aug 2 at 10 AM … Interested · Share · 1.8K interested".
 *
 * This shape dominates the harvest, and it is NOT ours: a Facebook event with a
 * machine date at a named venue is an ordinary public market, which the EVENT
 * pipeline already ingests (facebook-feed → eventToRaw). Recognising it stops
 * hundreds of perfectly ordinary markets from queuing for human review as
 * "unclear" — they are not unclear, they are simply someone else's job.
 */
const FB_EVENT_CHROME =
  /\b(interested|going|went|share)\b|\b\d+(\.\d+)?k interested\b/;
const FB_EVENT_DATE =
  /\b(mon|tue|wed|thu|fri|sat|sun),?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\b/;

const IRRELEVANT = rules([
  [/\bkraemmere soeges\b|\bstadeholdere soeges\b/, 'efterlyser kræmmere (ikke et salg)'],
  [/\bsoeges\b|\bkoebes\b|\befterlyses\b/, 'efterlyser/køber'],
  [/\btak for i dag\b|\btak for et godt marked\b/, 'tak for i dag'],
  [/\bhusk vores sidste\b/, 'tilbageblik'],
  [/\bgratis\b.{0,15}\bafhentning\b/, 'gratis afhentning'],
]);

/**
 * Does the text concern second-hand goods at all? Without this we cannot tell a
 * barn sale from a car boot full of firewood.
 *
 * NOTE the deliberate lack of a trailing \b on the stems: Danish compounds
 * relentlessly ("antikhandel", "loppesalg", "genbrugsbutik", "dødsbolager"), so
 * anchoring the end of the word makes the gate miss the very posts it is meant
 * to admit. This is NOT the only way in — an idiomatic habit phrase ("åbner
 * laden") is itself domain evidence even when no flea word appears, so the
 * caller ORs this with the phrase hits rather than gating on it alone.
 */
const FLEA_VOCAB = /\bloppe|\bkraemmer|\bgenbrug|\bantik|\bbrugte?\b|\bbohave\b|\bindbo\b|\bsamler|\bdoedsbo|\bretro\b|\bvintage\b/;

function hits(text: string, rs: Rule[]): string[] {
  return rs.filter((r) => r.re.test(text)).map((r) => r.says);
}

const TYPE_BY_EVIDENCE: Array<[RegExp, InformalPlaceType]> = [
  [/doedsbo|afdoede/, 'doedsbo'],
  [/lade/, 'loppelade'],
  [/gaard/, 'gaardsalg'],
  [/garage/, 'garagesalg'],
  [/skur|selvbetjent/, 'loppeskur'],
  [/hal/, 'privat-hal'],
  [/forening|kirke|spejder/, 'foreningsloppe'],
];

/**
 * Classify one Danish post.
 *
 * Reads top-down as a decision list; the first confident verdict wins, and
 * anything ambiguous ends at 'kraever_review' rather than guessing. Ties go to
 * the CAUTIOUS side (one-off, review) — publishing a private home as a
 * permanent destination is the expensive mistake here, not missing a barn.
 */
/**
 * Is this post worth KEEPING in the raw corpus at all?
 *
 * Exists for the Facebook harvester, whose gate is a config-supplied keyword
 * list — and that list is necessarily about EVENTS ("loppemarked",
 * "kræmmermarked", "stadeplads"). Measured on a real 429-post harvest: 392 posts
 * carried an event word, only 6 mentioned a hidden place, and ALL SIX also
 * happened to contain an event word. Not one post got in on its own hidden-place
 * merit — so the corpus that informal_place is built from had already been
 * filtered to exclude exactly what it is looking for, and no classifier
 * downstream could recover a post the harvester never wrote down.
 *
 * So the harvest gate ORs this in as a FLOOR that a config cannot silently omit.
 * It deliberately reuses the same phrase tables classifyPost() judges with: a
 * separate hand-kept list in the script would drift out of step with the
 * classifier, and the drift would be invisible — missing posts leave no trace.
 *
 * Keep it CHEAP and slightly generous. This decides what gets written down, not
 * what gets published; classifyPost() and an operator both still stand between
 * a post and a live page. A false positive costs a line in a JSON file. A false
 * negative costs a hidden place nobody will ever find again.
 */
export function isFleaCorpusCandidate(rawText: string): boolean {
  const t = fold(rawText);
  return (
    FLEA_VOCAB.test(t) ||
    PLACE_HABIT.some((r) => r.re.test(t)) ||
    DOEDSBO.some((r) => r.re.test(t)) ||
    FORENING.some((r) => r.re.test(t))
  );
}

export function classifyPost(rawText: string): Classification {
  const t = fold(rawText);
  const evidence: string[] = [];

  // Phrase evidence is computed BEFORE the vocabulary gate: an idiomatic habit
  // phrase IS domain evidence on its own. "Vi åbner laden igen hver lørdag"
  // contains no flea word at all, yet it is unmistakably one of ours — gating on
  // vocabulary first threw exactly those posts away.
  const habit = hits(t, PLACE_HABIT);
  const doedsbo = hits(t, DOEDSBO);
  const professional = hits(t, PROFESSIONAL);
  const irrelevant = hits(t, IRRELEVANT);
  const flea = FLEA_VOCAB.test(t) || habit.length > 0 || doedsbo.length > 0;

  // Nothing about second-hand goods at all → not ours.
  if (!flea) {
    return {
      label: 'irrelevant',
      confidence: 0.9,
      placeType: null,
      evidence: ['ingen loppe-/genbrugsord i teksten'],
      needsReview: false,
    };
  }
  // "Kræmmere søges" is an advert for stallholders, not a sale to visit.
  if (irrelevant.length > 0 && habit.length === 0) {
    return { label: 'irrelevant', confidence: 0.75, placeType: null, evidence: irrelevant, needsReview: false };
  }

  if (professional.length >= 2) {
    return { label: 'professionel_antikhandel', confidence: 0.8, placeType: null, evidence: professional, needsReview: false };
  }

  const shop = hits(t, PERMANENT_SHOP);
  if (shop.length > 0 && habit.length === 0) {
    return { label: 'fast_genbrugssted', confidence: 0.75, placeType: null, evidence: shop, needsReview: false };
  }

  // A scraped FB event listing with a machine date = a public market, and the
  // event pipeline's business — unless the text ALSO describes a private habit.
  if (FB_EVENT_CHROME.test(t) && FB_EVENT_DATE.test(t) && habit.length === 0) {
    return {
      label: 'loppemarked',
      confidence: 0.7,
      placeType: null,
      evidence: ['Facebook-event med dato — offentligt marked'],
      needsReview: false,
    };
  }

  const market = hits(t, PUBLIC_MARKET);
  const recurring = hits(t, RECURRING);
  const oneOff = hits(t, ONE_OFF);
  const forening = hits(t, FORENING);

  // A public market with stalls/entry is the EVENT pipeline's business, not ours
  // — unless the text also clearly describes a private habit-place.
  if (market.length > 0 && habit.length === 0) {
    return { label: 'loppemarked', confidence: 0.7, placeType: null, evidence: market, needsReview: false };
  }

  if (forening.length > 0 && habit.length === 0 && market.length === 0) {
    evidence.push(...forening);
    return { label: 'foreningsmarked', confidence: 0.6, placeType: 'foreningsloppe', evidence, needsReview: true };
  }

  // --- the decisive fork: a PLACE with a habit, or a ONE-OFF sale? ---
  const placeish = habit.length > 0;
  const recurs = recurring.length > 0;

  if (doedsbo.length > 0) {
    evidence.push(...doedsbo, ...habit, ...recurring, ...oneOff);
    // A dødsbo can be either: a one-weekend clearance, or a semi-permanent
    // lager that keeps reopening. Only a recurrence signal makes it a place.
    if (recurs || placeish) {
      return { label: 'informal_place', confidence: 0.7, placeType: 'doedsbo', evidence, needsReview: true };
    }
    return { label: 'doedsbosalg', confidence: 0.75, placeType: null, evidence, needsReview: false };
  }

  if (oneOff.length > 0 && !recurs) {
    evidence.push(...oneOff);
    const moving = /flyttesalg/.test(t);
    return {
      label: moving ? 'flyttesalg' : 'enkeltstaaende_privatsalg',
      confidence: 0.75,
      placeType: null,
      evidence,
      needsReview: false,
    };
  }

  if (placeish) {
    evidence.push(...habit, ...recurring);
    const blob = evidence.join(' ');
    const placeType = TYPE_BY_EVIDENCE.find(([re]) => re.test(fold(blob)))?.[1] ?? 'privat-saelger';
    // A habit phrase WITHOUT a recurrence signal is promising but unproven —
    // exactly the case a human should confirm before it becomes a map pin.
    return {
      label: 'informal_place',
      confidence: recurs ? 0.8 : 0.55,
      placeType,
      evidence,
      needsReview: !recurs,
    };
  }

  // Flea vocabulary, but nothing that tells us WHAT it is.
  return {
    label: 'kraever_review',
    confidence: 0.3,
    placeType: null,
    evidence: flea ? ['loppe-ord, men uklart hvad det er'] : [],
    needsReview: true,
  };
}
