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
];
