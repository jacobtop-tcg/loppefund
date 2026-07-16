import type {
  InformalPlaceType,
  InformalPlaceStatus,
  InventorySignal,
  TrustLayer,
} from '@loppefund/core';

/**
 * Danish labels for the informal-place vocabulary.
 *
 * Client-safe (no 'server-only'): the Explorer filters need these too. Kept
 * apart from the core model so wording can change without touching scoring.
 */

export const PLACE_TYPE_LABELS: Record<InformalPlaceType, string> = {
  loppelade: 'Loppelade',
  gaardsalg: 'Gårdsalg',
  garagesalg: 'Garagesalg',
  doedsbo: 'Dødsbo',
  loppeskur: 'Loppeskur',
  'privat-hal': 'Privat hal',
  foreningsloppe: 'Foreningsloppe',
  'privat-saelger': 'Privat sælger',
  genbrugsbod: 'Genbrugsbod',
  andet: 'Skjult loppested',
};

/**
 * What a place is known to hold, in the words a hunter would use.
 *
 * These drive the "Hvad leder du efter?" chips — the filter that matters most,
 * because nobody drives out to "a loppelade"; they drive out for the vinyl.
 */
export const SIGNAL_LABELS: Record<InventorySignal, string> = {
  moebler: 'Møbler',
  'dansk-design': 'Dansk design',
  keramik: 'Keramik',
  porcelaen: 'Porcelæn',
  glas: 'Glas',
  vinyl: 'Vinyl',
  lego: 'Lego',
  legetoej: 'Legetøj',
  vaerktoej: 'Værktøj',
  elektronik: 'Elektronik',
  boeger: 'Bøger',
  toej: 'Tøj',
  smykker: 'Smykker',
  samlerobjekter: 'Samlerobjekter',
  cykler: 'Cykler',
  retro: 'Retro',
  antik: 'Antik',
  landbrugsantik: 'Landbrugsantik',
  lamper: 'Lamper',
  usorteret: 'Usorteret',
  blandet: 'Blandet',
};

export const STATUS_LABELS: Record<InformalPlaceStatus, string> = {
  confirmed_active: 'Bekræftet aktivt',
  recently_observed: 'Set nyligt',
  active_online: 'Aktiv online',
  sporadic: 'Sporadisk åbent',
  call_first: 'Ring først',
  unverified: 'Ubekræftet',
  possibly_inactive: 'Måske lukket',
  historical: 'Historisk',
  rejected: 'Afvist',
};

/**
 * The three trust layers, in the visitor's own words.
 *
 * The wording is the product: a Radar place must read as a lead you might
 * investigate, never as a destination you can plan a Saturday around. That is
 * why the Radar copy leads with what we DON'T know.
 */
export const TRUST_LAYER_LABELS: Record<TrustLayer, { title: string; body: string }> = {
  bekraeftet: {
    title: 'Bekræftet sted.',
    body: 'Kilderne er efterprøvet, og stedet er set for nylig. Du kan planlægge efter det.',
  },
  'kontroller-foerst': {
    title: 'Kontrollér før du kører.',
    body: 'Stedet ser ægte ud, men åbningen er uforudsigelig. Ring eller tjek opslaget først.',
  },
  radar: {
    title: 'Loppefund Radar — ikke bekræftet.',
    body: 'Et spor, vi endnu ikke har kunnet efterprøve. Det kan være forkert, lukket eller slet ikke findes. Kør ikke efter det alene.',
  },
};

export const TRUST_LAYER_SHORT: Record<TrustLayer, string> = {
  bekraeftet: 'Bekræftet',
  'kontroller-foerst': 'Kontrollér først',
  radar: 'Radar',
};
