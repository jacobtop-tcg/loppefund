import type { SourceAdapter } from './types.ts';
import { markedskalenderen } from './markedskalenderen.ts';
import { loppemarkederNu } from './loppemarkeder-nu.ts';
import { findmarked } from './findmarked.ts';

/** Registered source adapters. Each is independent and replaceable. */
export const adapters: SourceAdapter[] = [markedskalenderen, loppemarkederNu, findmarked];
