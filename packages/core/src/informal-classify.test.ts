import { describe, expect, it } from 'vitest';
import { classifyPost , isFleaCorpusCandidate} from './informal-classify.ts';

describe('classifyPost — the hidden-place vocabulary', () => {
  it('recognises a recurring barn as an informal place', () => {
    const r = classifyPost('Vi åbner laden igen på lørdag — hver lørdag hele sommeren. Nye ting i laden!');
    expect(r.label).toBe('informal_place');
    expect(r.placeType).toBe('loppelade');
    expect(r.needsReview).toBe(false); // recurrence is evidenced
    expect(r.evidence.join(' ')).toMatch(/åbner laden/);
  });

  it('recognises "flaget er ude"', () => {
    const r = classifyPost('Loppesalg på adressen — vi har åbent når flaget er ude.');
    expect(r.label).toBe('informal_place');
  });

  it('recognises a self-service shed and a farmyard sale', () => {
    expect(classifyPost('Selvbetjent loppeskur med brugte ting, åbent hver dag').label).toBe('informal_place');
    expect(classifyPost('Gårdsalg med lopper — åbent på gården hver søndag').placeType).toBe('gaardsalg');
  });

  it('recognises a recurring garage sale', () => {
    const r = classifyPost('Lopper i garagen igen — hver anden søndag. Kom og gør et kup!');
    expect(r.label).toBe('informal_place');
    expect(r.placeType).toBe('garagesalg');
  });
});

// ===========================================================================
// THE DECISIVE FORK. A one-off sale must NEVER become a permanent map pin at a
// private person's home. Ties go to the cautious side.
// ===========================================================================
describe('classifyPost — one-off vs a place with a habit', () => {
  it('calls a plain flyttesalg a one-off, not a place', () => {
    const r = classifyPost('Flyttesalg lørdag d. 8. august — alt skal væk! Bohave sælges.');
    expect(r.label).toBe('flyttesalg');
    expect(r.placeType).toBeNull();
  });

  it('calls "alt skal væk" a one-off private sale', () => {
    const r = classifyPost('Privat loppesalg, alt skal væk, kun på lørdag');
    expect(['enkeltstaaende_privatsalg', 'flyttesalg']).toContain(r.label);
  });

  it('treats a plain dødsbo clearance as a one-off sale', () => {
    const r = classifyPost('Vi rydder dødsbo — indbo sælges lørdag, alt skal væk');
    expect(r.label).toBe('doedsbosalg');
  });

  it('BUT promotes a dødsbo LAGER that keeps reopening to a place', () => {
    const r = classifyPost('Dødsbo-lager i laden — vi holder åbent igen hver lørdag hele sæsonen');
    expect(r.label).toBe('informal_place');
    expect(r.placeType).toBe('doedsbo');
  });

  it('marks a habit WITHOUT recurrence for review rather than publishing it', () => {
    const r = classifyPost('Vi åbner laden på lørdag med lopper');
    expect(r.label).toBe('informal_place');
    expect(r.needsReview).toBe(true); // promising, unproven
    expect(r.confidence).toBeLessThan(0.7);
  });
});

describe('classifyPost — what belongs to the OTHER pipelines', () => {
  it('leaves a public kræmmermarked to the event pipeline', () => {
    const r = classifyPost('Stort kræmmermarked i Arena Svendborg — stadepladser kan lejes, entré 20 kr');
    expect(r.label).toBe('loppemarked');
  });

  it('leaves a charity chain shop to the venue layer', () => {
    const r = classifyPost('Røde Kors genbrugsbutik — åbningstider mandag til fredag 10-17');
    expect(r.label).toBe('fast_genbrugssted');
  });

  it('spots a professional antique trade', () => {
    const r = classifyPost('Antikhandel med kurateret udvalg — se vores webshop, CVR 12345678');
    expect(r.label).toBe('professionel_antikhandel');
  });
});

describe('classifyPost — refusing junk', () => {
  it('rejects a post with no flea vocabulary at all', () => {
    const r = classifyPost('Vi holder sommerfest med fadøl og musik på lørdag');
    expect(r.label).toBe('irrelevant');
  });

  it('rejects "kræmmere søges" — an advert for stallholders, not a sale', () => {
    expect(classifyPost('KRÆMMERE SØGES til vores loppemarked').label).toBe('irrelevant');
  });

  it('rejects a backward-looking post', () => {
    expect(classifyPost('Husk vores sidste loppemarked — tak for i dag!').label).toBe('irrelevant');
  });

  it('sends genuinely ambiguous flea text to review instead of guessing', () => {
    const r = classifyPost('Lopper og sager');
    expect(r.label).toBe('kraever_review');
    expect(r.needsReview).toBe(true);
  });

  it('always explains itself', () => {
    const r = classifyPost('Vi åbner laden igen hver lørdag');
    expect(r.evidence.length).toBeGreaterThan(0);
  });

  it('is deterministic', () => {
    const t = 'Gårdsalg med lopper hver søndag';
    expect(classifyPost(t)).toEqual(classifyPost(t));
  });
});

describe('isFleaCorpusCandidate — the harvest gate floor', () => {
  // THE MEASURED BUG: on a real 429-post harvest, 392 posts carried an event
  // word and only 6 mentioned a hidden place — all six riding in on an event
  // word they happened to contain. Not one got in on its own merit, because the
  // config keyword list is necessarily about events. These are the posts that
  // were being thrown away at the door.
  it('admits a hidden place that never says "loppemarked"', () => {
    for (const post of [
      'Vi åbner laden igen på lørdag — masser af gammelt indbo',
      'Der er åbent på gården hele weekenden, kom forbi',
      'Kig ind når flaget er ude',
      'Vi rydder et dødsbo og sælger fra 10-15',
      'Selvbetjent loppeskur ved indkørslen, betal i kassen',
      'Gårdsalg søndag — møbler, porcelæn og værktøj',
      'Lopper i garagen igen i weekenden',
    ]) {
      expect(isFleaCorpusCandidate(post)).toBe(true);
    }
  });

  it('still admits the ordinary event posts the old gate kept', () => {
    expect(isFleaCorpusCandidate('Stort loppemarked i Svendborg på lørdag')).toBe(true);
    expect(isFleaCorpusCandidate('Kræmmermarked med 40 stader')).toBe(true);
  });

  it('does not admit posts about nothing of ours', () => {
    for (const post of [
      'Sælger min bil, Toyota Yaris 2012, ring for pris',
      'Nogen der har set min kat? Sort med hvide poter',
      'Tak for en dejlig fest i går alle sammen',
      'Til salg: barnevogn, næsten ny',
    ]) {
      expect(isFleaCorpusCandidate(post)).toBe(false);
    }
  });

  it('is generous rather than clever — it decides what gets WRITTEN DOWN', () => {
    // A false positive costs a line in a JSON file; a false negative costs a
    // hidden place nobody will ever find again. classifyPost() and a human both
    // still stand between this and a published page.
    expect(isFleaCorpusCandidate('Foreningen holder loppesalg i kælderen')).toBe(true);
    expect(isFleaCorpusCandidate('Spejderne sælger brugte ting til fordel for turen')).toBe(true);
  });
});
