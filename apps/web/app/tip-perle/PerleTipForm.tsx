'use client';

import { useState } from 'react';

/**
 * "Tip en skjult perle" — the intake for hidden places.
 *
 * Same rail as every other community input here (Web3Forms → operator inbox →
 * a human vets → data/informal-places.json → the crawl applies it), because the
 * site is a static export with no backend. Nothing submitted here is published
 * automatically, and for THIS form that gate matters more than for any other:
 * these tips point at private people's homes.
 *
 * TWO FIELDS CARRY REAL WEIGHT:
 *  - "Må adressen offentliggøres?" is where a stranger's home address gets its
 *    consent, so it is REQUIRED, has no pre-selected permissive answer, and
 *    defaults to the cautious side if the reporter says they don't know.
 *  - The consent checkbox is required and unticked.
 * A tip that arrives without an explicit "yes" to publishing the address can
 * still become a place — it just becomes an area-only one. That is the whole
 * point of the visibility model: we can be useful without being invasive.
 */
const WEB3FORMS_KEY = process.env.NEXT_PUBLIC_WEB3FORMS_KEY;
const TIP_EMAIL = process.env.NEXT_PUBLIC_TIP_EMAIL ?? 'hej@loppefund.dk';

const PLACE_TYPES: Array<[string, string]> = [
  ['loppelade', 'Loppelade'],
  ['gaardsalg', 'Gårdsalg'],
  ['garagesalg', 'Garagesalg'],
  ['doedsbo', 'Dødsbo-lager'],
  ['loppeskur', 'Selvbetjent loppeskur'],
  ['privat-hal', 'Privat hal'],
  ['foreningsloppe', 'Foreningsloppe'],
  ['privat-saelger', 'Privat sælger'],
  ['genbrugsbod', 'Genbrugsbod'],
  ['andet', 'Ved ikke / andet'],
];

const VISIBILITY: Array<[string, string]> = [
  ['fuld', 'Ja — stedet er offentligt kendt, adressen må vises'],
  ['kun-aabningsdage', 'Kun når der er åbent'],
  ['kontakt-kraeves', 'Nej — man skal kontakte først'],
  ['omraade', 'Jeg er i tvivl — vis kun det omtrentlige område'],
];

const CATEGORIES: Array<[string, string]> = [
  ['moebler', 'Møbler'], ['dansk-design', 'Dansk design'], ['keramik', 'Keramik'],
  ['porcelaen', 'Porcelæn'], ['glas', 'Glas'], ['vinyl', 'Vinyl'], ['lego', 'LEGO'],
  ['legetoej', 'Legetøj'], ['vaerktoej', 'Værktøj'], ['elektronik', 'Elektronik'],
  ['boeger', 'Bøger'], ['toej', 'Tøj'], ['smykker', 'Smykker'],
  ['samlerobjekter', 'Samlerobjekter'], ['cykler', 'Cykler'], ['retro', 'Retro'],
  ['antik', 'Antik'], ['landbrugsantik', 'Landbrugsantik'], ['lamper', 'Lamper'],
  ['usorteret', 'Usorteret rod'],
];


/**
 * A yes / no / don't-know question.
 *
 * These were checkboxes, and an unticked box was sent as "nej/ved ikke". But
 * "der er intet skilt" and "jeg kiggede ikke efter" are DIFFERENT facts about a
 * stranger's driveway, and the model has `boolean | null` precisely so it can
 * hold the difference. Collapsing them threw away the only thing that
 * distinguishes an observation from a silence — and then an operator had to
 * guess which one the tipper meant.
 *
 * Nothing is pre-selected: a default would be us answering on their behalf.
 */
function TriState({ name, label }: { name: string; label: string }) {
  return (
    <fieldset className="perle-tri">
      <legend className="perle-cap">{label}</legend>
      {[
        ['ja', 'Ja'],
        ['nej', 'Nej'],
        ['ukendt', 'Ved ikke'],
      ].map(([v, l]) => (
        <label key={v} className="perle-check">
          <input type="radio" name={name} value={v} /> <span>{l}</span>
        </label>
      ))}
    </fieldset>
  );
}

export function PerleTipForm() {
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');
  const [error, setError] = useState('');

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    if (String(data.get('website') ?? '')) return; // honeypot

    const name = String(data.get('name') ?? '').trim();
    const where = String(data.get('where') ?? '').trim();
    if (!name || !where) {
      setError('Vi skal som minimum bruge et navn og hvor stedet ligger.');
      return;
    }
    if (!data.get('consent')) {
      setError('Sæt flueben i samtykke, så vi må behandle oplysningerne.');
      return;
    }
    setError('');

    const categories = CATEGORIES.filter(([v]) => data.get(`cat_${v}`)).map(([, l]) => l);
    const payload: Record<string, string> = {
      navn: name,
      hvor: where,
      type: String(data.get('placeType') ?? ''),
      adresse_maa_vises: String(data.get('visibility') ?? ''),
      // "" when unanswered. An unanswered question is not a "no" — the operator
      // must be able to see which questions the tipper actually answered.
      skilt_ved_vejen: String(data.get('sign') ?? ''),
      faste_aabningstider: String(data.get('openingNotes') ?? ''),
      ring_foerst: String(data.get('callFirst') ?? ''),
      flaget_er_ude: String(data.get('flag') ?? ''),
      sidst_besoegt: String(data.get('lastVisit') ?? ''),
      varer: categories.join(', '),
      prisniveau: String(data.get('priceLevel') ?? ''),
      kan_forhandles: String(data.get('negotiable') ?? ''),
      kontakt: String(data.get('contact') ?? ''),
      kildelink: String(data.get('sourceUrl') ?? ''),
      kommentar: String(data.get('comment') ?? ''),
      indsender: String(data.get('reporter') ?? ''),
    };
    // Which place is this about? The detail page's "Send en rettelse" link hands
    // us the slug; without it the operator received "åbningstiderne passer ikke"
    // with no way to know which of N places it meant. Read from the URL at
    // submit time rather than via useSearchParams, which would need a Suspense
    // boundary under `output: export` for a single string.
    const about =
      typeof window !== 'undefined'
        ? new URLSearchParams(window.location.search).get('sted')
        : null;
    if (about) payload.retter_sted = about;

    if (WEB3FORMS_KEY) {
      setState('sending');
      try {
        const res = await fetch('https://api.web3forms.com/submit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            access_key: WEB3FORMS_KEY,
            subject: `Skjult perle: ${name}`,
            from_name: 'Loppefund perle-tip',
            ...payload,
          }),
        });
        setState(res.ok ? 'done' : 'error');
      } catch {
        setState('error');
      }
      return;
    }

    const body = Object.entries(payload)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`)
      .join('\n');
    window.location.href = `mailto:${TIP_EMAIL}?subject=${encodeURIComponent(
      `Skjult perle: ${name}`,
    )}&body=${encodeURIComponent(body)}`;
    setState('done');
  }

  if (state === 'done') {
    return (
      <section className="panel" role="status">
        <h2>Tak — det er guld værd.</h2>
        <p>
          Vi kigger på det med det samme. Skjulte steder bliver aldrig lagt op automatisk: et
          menneske læser dit tip igennem, før stedet kommer på kortet. Har du sagt at adressen
          ikke må vises, viser vi kun det omtrentlige område.
        </p>
      </section>
    );
  }

  return (
    <form className="perle-form" onSubmit={onSubmit}>
      <input type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden style={{ position: 'absolute', left: -9999 }} />

      <fieldset>
        <legend>Stedet</legend>
        <label>
          <span className="perle-cap">Hvad kaldes stedet? <span className="req">*</span></span>
          <input name="name" required placeholder="fx “Loppeladen ved Guderup”" />
          <small>Har det ikke noget navn, så skriv hvad folk kalder det.</small>
        </label>
        <label>
          <span className="perle-cap">Hvor ligger det? <span className="req">*</span></span>
          <input name="where" required placeholder="Adresse, vej eller bare “ved Guderup, 6430”" />
          <small>Præcis adresse hvis du har den — ellers er området fint.</small>
        </label>
        <label>
          <span className="perle-cap">Type af sted</span>
          <select name="placeType" defaultValue="andet">
            {PLACE_TYPES.map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </label>
      </fieldset>

      {/* The consent decision. No permissive default: the reporter must choose,
          and "i tvivl" resolves to area-only. */}
      <fieldset className="perle-consent-block">
        <legend>Må adressen offentliggøres? <span className="req">*</span></legend>
        <p className="perle-hint">
          Det her er tit et privat hjem. Vi viser kun en præcis adresse, hvis den må vises.
        </p>
        {VISIBILITY.map(([v, l], i) => (
          <label key={v} className="perle-radio">
            <input type="radio" name="visibility" value={v} required={i === 0} />
            <span>{l}</span>
          </label>
        ))}
      </fieldset>

      <fieldset>
        <legend>Sådan kommer man ind</legend>
        <TriState name="sign" label="Er der et skilt ved vejen?" />
        <TriState name="callFirst" label="Skal man ringe først?" />
        <TriState name="flag" label="Åbent når flaget er ude?" />
        <label>
          <span className="perle-cap">Faste åbningstider?</span>
          <input name="openingNotes" placeholder="fx “søndage 10-16” eller “kun når flaget er ude”" />
        </label>
        <label>
          <span className="perle-cap">Hvornår var du der sidst?</span>
          <input type="date" name="lastVisit" />
          <small>Det afgør hvor meget vi tør stole på oplysningen.</small>
        </label>
      </fieldset>

      <fieldset>
        <legend>Hvad er der?</legend>
        <div className="perle-cats">
          {CATEGORIES.map(([v, l]) => (
            <label key={v} className="perle-cat">
              <input type="checkbox" name={`cat_${v}`} /> <span>{l}</span>
            </label>
          ))}
        </div>
        <label>
          <span className="perle-cap">Prisniveau</span>
          <select name="priceLevel" defaultValue="">
            <option value="">Ved ikke</option>
            <option value="lav">Lavt</option>
            <option value="middel">Middel</option>
            <option value="hoej">Højt</option>
          </select>
        </label>
        <TriState name="negotiable" label="Kan man forhandle?" />
      </fieldset>

      <fieldset>
        <legend>Kilder og kontakt</legend>
        <label>
          <span className="perle-cap">Telefon eller kontaktlink til stedet</span>
          <input name="contact" placeholder="Kun hvis det er oplyst offentligt" />
        </label>
        <label>
          <span className="perle-cap">Kildelink</span>
          <input name="sourceUrl" type="url" placeholder="Link til opslag, side eller artikel" />
        </label>
        <label>
          <span className="perle-cap">Kommentar</span>
          <textarea name="comment" rows={3} placeholder="Alt hvad der er værd at vide — fx “ejeren er der kun om formiddagen”" />
        </label>
        <label>
          <span className="perle-cap">Dit navn eller kaldenavn</span>
          <input name="reporter" placeholder="Frivilligt" />
        </label>
      </fieldset>

      <label className="perle-check perle-consent">
        <input type="checkbox" name="consent" required />{' '}
        <span>
          Jeg må gerne dele de her oplysninger, og Loppefund må behandle og vise dem efter
          reglerne ovenfor. <span className="req">*</span>
        </span>
      </label>

      {error && <p className="tip-error" role="alert">{error}</p>}
      <button type="submit" className="perle-submit" disabled={state === 'sending'}>
        {state === 'sending' ? 'Sender…' : 'Send tippet'}
      </button>
      {state === 'error' && (
        <p className="tip-error" role="alert">
          Kunne ikke sende lige nu. Prøv igen, eller skriv til {TIP_EMAIL}.
        </p>
      )}
      <p className="perle-footnote">
        Billeder hjælper meget. Send dem gerne til {TIP_EMAIL} med stedets navn — så knytter vi
        dem til tippet. (Upload direkte i formularen kommer senere.)
      </p>
    </form>
  );
}
