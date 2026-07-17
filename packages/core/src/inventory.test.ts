import { describe, expect, it } from 'vitest';
import { extractInventorySignals } from './inventory.ts';

const sig = (s: string | null) => extractInventorySignals(s);

describe('extractInventorySignals', () => {
  it('says nothing when the text says nothing about goods', () => {
    // The COMMON case — 63% of the corpus. [] means "we don't know", never
    // "nothing here", and no caller may read it as absence.
    expect(sig('Stort loppemarked på Torvet lørdag kl. 10-15. Gratis entré.')).toEqual([]);
    expect(sig(null)).toEqual([]);
    expect(sig('')).toEqual([]);
  });

  it('reads the plain cases out of real phrasing', () => {
    expect(sig('Gamle møbler, lamper og bohave sælges')).toContain('moebler');
    expect(sig('Masser af legetøj, bamser og BRIO-tog')).toContain('legetoej');
    expect(sig('Vi har vinyl, LP\'er og gamle grammofonplader')).toContain('vinyl');
    expect(sig('Keramik og stentøj fra lokale værksteder')).toContain('keramik');
    expect(sig('Royal Copenhagen og Bing & Grøndahl porcelæn')).toContain('porcelaen');
    expect(sig('Antikvitetsmarked med antikke ting')).toContain('antik');
  });

  // JS \b is ASCII-only, so a word starting with æ/ø/å gets no boundary. The
  // whole extractor rests on the W lookbehind instead — if that breaks, the
  // Danish words are exactly the ones that stop matching.
  it('matches words that START with ø/æ/å', () => {
    expect(sig('Øreringe og smykker')).toContain('smykker');
    expect(sig('Ærlige priser på møbler')).toContain('moebler');
  });

  // ---- THE EXCLUSIONS. Each of these was a real false positive waiting. ----

  it('does NOT read a market STALL as furniture', () => {
    // "bord" at a flea market is nearly always a stall for rent. Matching it
    // would have tagged half the corpus as selling furniture.
    expect(sig('Book et bord for 150 kr. Borde kan lejes ved indgangen.')).toEqual([]);
    expect(sig('Pris pr. bord: 100 kr. Medbring selv stole.')).toEqual([]);
  });

  it('does NOT read building materials as vinyl', () => {
    expect(sig('Gipsplader og plader til taget sælges')).toEqual([]);
    expect(sig('Plader til gulvet')).toEqual([]);
  });

  it('does NOT read the café into the inventory', () => {
    expect(sig('Der kan købes kaffe og et glas vin i caféen')).toEqual([]);
    expect(sig('Kaffemaskine og symaskine i madteltet')).not.toContain('vaerktoej');
  });

  it('does NOT read charity language as collectibles', () => {
    // "vi samler ind til" is everywhere in forening markets.
    expect(sig('Vi samler ind til spejderturen')).not.toContain('samlerobjekter');
    expect(sig('Overskuddet samler vi sammen til klubben')).not.toContain('samlerobjekter');
  });

  it('does NOT read a stray "bog" as a book stall', () => {
    expect(sig('Læs mere i bogen om markedets historie')).not.toContain('boeger');
    expect(sig('Bøger og tegneserier')).toContain('boeger');
  });

  it('does NOT read "tøjcontainer" as a clothing stall', () => {
    // A Røde Kors tøjcontainer is a donation bin, not goods for sale — the exact
    // wording that caused a real bug report on the venue side.
    expect(sig('Røde Kors tøjcontainer står ved parkeringen')).not.toContain('toej');
    expect(sig('Børnetøj og sko i alle størrelser')).toContain('toej');
  });

  it('requires a designer name before claiming dansk design', () => {
    expect(sig('Et smukt designet marked i hjertet af byen')).not.toContain('dansk-design');
    expect(sig('Wegner-stole og Kaare Klint')).toContain('dansk-design');
  });

  it('finds several interests in one description, without duplicates', () => {
    const out = sig('Loppemarked med møbler, tøj, legetøj, vinyl og gamle møbler igen');
    expect(out).toEqual([...new Set(out)]);
    expect(out).toEqual(expect.arrayContaining(['moebler', 'toej', 'legetoej', 'vinyl']));
  });

  it('is stable in order, so a rebuild does not churn the data', () => {
    const a = sig('Vinyl og møbler');
    const b = sig('Møbler og vinyl');
    expect(a).toEqual(b); // rule order decides, not text order
  });
});
