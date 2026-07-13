import type { SourceAdapter } from './types.ts';
import { markedskalenderen } from './markedskalenderen.ts';
import { loppemarkederNu } from './loppemarkeder-nu.ts';
import { findmarked } from './findmarked.ts';
import { kultunaut } from './kultunaut.ts';
import { facebookFeed } from './facebook-feed.ts';
import { sydfynskalenderen } from './sydfynskalenderen.ts';
import { bagagerumsmarkedViborg } from './bagagerumsmarked-viborg.ts';
import { kirkebyGamleMejeri } from './kirkeby-gamle-mejeri.ts';
import { vorbasseMarked } from './vorbasse-marked.ts';
import { goerlevMarked } from './goerlev-marked.ts';
import { hgLoppemarked } from './hg-loppemarked.ts';
import { raskevent } from './raskevent.ts';
import { jharrangementer } from './jharrangementer.ts';
import { olg } from './olg.ts';
import { gentofte } from './gentofte.ts';
import { loppebjornen } from './loppebjornen.ts';
import { tippelsbjerggaard } from './tippelsbjerggaard.ts';
import { oplevelserKbh } from './oplevelser-kbh.ts';
import { visitdenmark } from './visitdenmark.ts';
import { bornholmermarked } from './bornholmermarked.ts';
import { ksmarked } from './ksmarked.ts';
import { holte } from './holte.ts';

/** Registered source adapters. Each is independent and replaceable. */
export const adapters: SourceAdapter[] = [
  markedskalenderen,
  loppemarkederNu,
  findmarked,
  kultunaut,
  facebookFeed,
  sydfynskalenderen,
  bagagerumsmarkedViborg,
  kirkebyGamleMejeri,
  vorbasseMarked,
  goerlevMarked,
  hgLoppemarked,
  raskevent,
  jharrangementer,
  olg,
  gentofte,
  loppebjornen,
  tippelsbjerggaard,
  oplevelserKbh,
  visitdenmark,
  bornholmermarked,
  ksmarked,
  holte,
];
