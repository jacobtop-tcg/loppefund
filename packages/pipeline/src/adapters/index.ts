import type { SourceAdapter } from './types.ts';
import { markedskalenderen } from './markedskalenderen.ts';

/** Registered source adapters. Each is independent and replaceable. */
export const adapters: SourceAdapter[] = [markedskalenderen];
