# Facebook-høst via Apify — fuldautomatisk opsætning

Loppefund crawler ikke selv Facebook (login-mur, kontorisiko). I stedet kører
leverandør-actors på skema hos Apify og lægger resultatet i datasets, som
pipelinen selv trækker og parser. Efter denne engangsopsætning er kæden
100 % automatisk: Apify høster dagligt → vores crawl (2×dagligt) henter
seneste dataset → hvert opslag/event parses, geokodes, dedupliceres og
publiceres med lav starttillid ("ubekræftet" indtil korroboreret).

## De tre flader

| Flade | Kvalitet | Actor-input her |
|---|---|---|
| **1. Begivenheder** (søgning pr. by/egn) | Høj — maskindatoer + koordinater | `events-input.json` (147 søgninger over hele landet) |
| **2. Grupper** (åbne + evt. lukkede) | Middel — fritekst, vores parser klarer resten | `groups-search-input.json` → `groups-scrape-input.json` |
| **3. Marketplace** | Lav — mest varesalg; dato-kravet frasorterer støj | `marketplace-input.json` |

Start med **1** — den fanger også det meste gruppeguld, fordi opslag ofte
linker til et FB-event. Tilføj **2** for de hyperlokale opslag uden event.

## Engangsopsætning (~10 min)

1. Opret konto på apify.com og kopiér API-tokenet (Settings → Integrations).
2. Vælg en events-actor (fx `apify/facebook-events-scraper`), indsæt
   indholdet af `events-input.json` som input, og sæt den på **dagligt skema**.
3. (Valgfrit) Kør en groups-search-actor med `groups-search-input.json`,
   kopiér gruppe-URL'erne ind i `groups-scrape-input.json`, og skemalæg en
   groups-actor. Lukkede grupper kræver cookies fra en medlemskonto —
   kontorisikoen ligger på den konto; udelad cookies for kun åbne grupper.
4. Læg tokenet i repoet: `gh secret set APIFY_TOKEN`
   (og evt. `gh variable set APIFY_ACTORS` hvis du bruger andre actors end
   standarderne `apify~facebook-events-scraper,apify~facebook-groups-scraper`).

Færdig. Pipelinen henter herefter automatisk **seneste vellykkede kørsel**
fra hver actor via
`api.apify.com/v2/acts/<actor>/runs/last/dataset/items` — ingen
orkestrering, ingen manuel eksport.

## Omkostning & risiko

- Apify har et gratis-tier; denne volumen (dagligt, DK-søgninger) ligger
  typisk på få hundrede kroner/md. hvis gratis-kvoten overskrides.
- Åbne grupper + events: ingen kontorisiko. Lukkede grupper: Meta kan
  lukke medlemskontoen — beslut selv, og start uden.
- Tillidsmodellen beskytter produktet: FB-data starter på tillid 0,4,
  vises "ubekræftet", og kan hverken aflyse eller overskrive bekræftede
  markeder fra stærkere kilder.
