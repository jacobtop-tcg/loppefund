import type { SourceAdapter } from './types.ts';
import { markedskalenderen } from './markedskalenderen.ts';
import { loppemarkederNu } from './loppemarkeder-nu.ts';
import { findmarked } from './findmarked.ts';
import { kultunaut } from './kultunaut.ts';
import { facebookFeed } from './facebook-feed.ts';

/** Registered source adapters. Each is independent and replaceable. */
export const adapters: SourceAdapter[] = [
  markedskalenderen,
  loppemarkederNu,
  findmarked,
  kultunaut,
  facebookFeed,
];
