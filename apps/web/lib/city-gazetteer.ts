import { distanceKm, foldForSearch } from './client-utils.ts';

/**
 * A town the visitor can pick as the start of a loppetur.
 *
 * Built client-side from the markets and shops already loaded — the app knows
 * where ~413 Danish towns are because it has coordinates for things in them. No
 * new endpoint, no geocoding service, no invented data.
 */
export interface CityPoint {
  /** What we OFFER. Either a verbatim data label or a base we can back. */
  label: string;
  lat: number;
  lng: number;
  /** Pre-folded for the picker's search. */
  fold: string;
  /** How many rows stand behind this point — ranks the suggestions. */
  weight: number;
}

/** Rows this can be built from: anything with a town name and a position. */
export interface PlacedRow {
  city?: string | null;
  lat?: number | null;
  lng?: number | null;
}

/**
 * Two labels sharing a base are the same town only if they are physically close.
 *
 * MEASURED, not tuned. Against the live database the largest LEGITIMATE group is
 * Odense — 8 real districts spanning 10.7 km. The nearest ambiguous group is
 * Hårlev (Stevns) vs Harlev J (Aarhus) at 166.1 km, and the worst is Nykøbing
 * Sj/M/F at 294.2 km — three different towns on three different islands. The
 * threshold sits in a 15x gap between "same town" and "not even close".
 *
 * This number is the whole safety of the grouping rule. Merging Hårlev with
 * Harlev J would hand someone a start point 166 km from home and state it as
 * fact — the exact failure this feature exists to fix.
 */
export const AMBIGUITY_KM = 25;

/**
 * Danish postal district suffixes. Stripping one trailing token is what lets us
 * find "Odense" at all — no row is labelled that; they are all "Odense C",
 * "Odense M", "Odense SØ". It is also what creates the collisions above, which
 * is why the distance check is not optional.
 */
const DISTRICT_TOKENS = new Set([
  'C', 'K', 'M', 'N', 'S', 'V', 'Ø', 'NV', 'SV', 'SØ', 'NØ', 'Sj', 'F', 'J',
]);

/** "Odense C" -> "Odense"; "Hårlev" -> "Hårlev". Strips at most one suffix. */
export function baseLabel(label: string): string {
  const parts = label.trim().split(/\s+/);
  if (parts.length < 2) return label.trim();
  return DISTRICT_TOKENS.has(parts[parts.length - 1]!) ? parts.slice(0, -1).join(' ') : label.trim();
}

interface Centroid {
  label: string;
  lat: number;
  lng: number;
  weight: number;
}

/**
 * A Danish town name never contains a digit. 15 rows in the live data have an
 * address or a postcode mashed into the city field (", 6640 Lunderskov, 6640
 * Lunderskov", "Friggasvej 14 Odense V"), and offering those as places to start
 * a trip from is nonsense wearing a town's clothes. This drops them from the
 * PICKER only — the underlying data is untouched, and fixing it is the crawler's
 * job, not this module's.
 */
const NOT_A_TOWN = /\d/;

function centroidsByLabel(rows: readonly PlacedRow[]): Centroid[] {
  const acc = new Map<string, { lat: number; lng: number; n: number }>();
  for (const r of rows) {
    const city = r.city?.trim();
    if (!city || NOT_A_TOWN.test(city) || r.lat == null || r.lng == null) continue;
    const cur = acc.get(city);
    if (cur) {
      cur.lat += r.lat;
      cur.lng += r.lng;
      cur.n += 1;
    } else {
      acc.set(city, { lat: r.lat, lng: r.lng, n: 1 });
    }
  }
  return [...acc].map(([label, v]) => ({
    label,
    lat: v.lat / v.n,
    lng: v.lng / v.n,
    weight: v.n,
  }));
}

/** The widest gap between any two members, in km. */
function spreadKm(members: readonly Centroid[]): number {
  let worst = 0;
  for (let i = 0; i < members.length; i++) {
    for (let j = i + 1; j < members.length; j++) {
      const d = distanceKm(members[i]!.lat, members[i]!.lng, members[j]!.lat, members[j]!.lng);
      if (d > worst) worst = d;
    }
  }
  return worst;
}

/** Prefer the heaviest base spelling, and a capitalised one over "rønnede". */
function bestBase(members: readonly Centroid[]): string {
  const byBase = new Map<string, number>();
  for (const m of members) {
    const b = baseLabel(m.label);
    byBase.set(b, (byBase.get(b) ?? 0) + m.weight);
  }
  return [...byBase].sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    const aUpper = /^[A-ZÆØÅ]/.test(a[0]);
    const bUpper = /^[A-ZÆØÅ]/.test(b[0]);
    if (aUpper !== bUpper) return aUpper ? -1 : 1;
    return a[0].localeCompare(b[0], 'da');
  })[0]![0];
}

/**
 * Build the pickable town list from whatever placed rows the client has.
 *
 * Pass BOTH markets and shops when you have them: 129 towns exist only in the
 * shop data, and the Hårlev/Harlev J collision spans the two — a gazetteer built
 * from one of them would not even see the ambiguity it has to guard against.
 */
export function buildCityGazetteer(rows: readonly PlacedRow[]): CityPoint[] {
  const centroids = centroidsByLabel(rows);
  const groups = new Map<string, Centroid[]>();
  for (const c of centroids) {
    const key = foldForSearch(baseLabel(c.label));
    const g = groups.get(key);
    if (g) g.push(c);
    else groups.set(key, [c]);
  }

  const out: CityPoint[] = [];
  for (const members of groups.values()) {
    // A lone label is offered VERBATIM. Never promote it to its base: a single
    // "Nykøbing F" must not become an offer to start in "Nykøbing", because we
    // would be naming a town whose location we do not actually know.
    if (members.length === 1) {
      const m = members[0]!;
      out.push({ label: m.label, lat: m.lat, lng: m.lng, fold: foldForSearch(m.label), weight: m.weight });
      continue;
    }
    if (spreadKm(members) > AMBIGUITY_KM) {
      // Different towns that merely spell alike. Offer each under its own
      // verbatim label and let the visitor say which one they meant — guessing
      // here is how you put someone's start 166 km from home.
      for (const m of members) {
        out.push({ label: m.label, lat: m.lat, lng: m.lng, fold: foldForSearch(m.label), weight: m.weight });
      }
      continue;
    }
    // One real town written several ways. Merge into a weighted centre.
    const total = members.reduce((n, m) => n + m.weight, 0);
    const label = bestBase(members);
    out.push({
      label,
      lat: members.reduce((s, m) => s + m.lat * m.weight, 0) / total,
      lng: members.reduce((s, m) => s + m.lng * m.weight, 0) / total,
      fold: foldForSearch(label),
      weight: total,
    });
  }
  return out.sort((a, b) => b.weight - a.weight || a.label.localeCompare(b.label, 'da'));
}

/** Prefix matches first, then contains. Mirrors the FilterBar suggestion feel. */
export function suggestCities(gazetteer: readonly CityPoint[], query: string, limit = 8): CityPoint[] {
  const q = foldForSearch(query.trim());
  if (!q) return gazetteer.slice(0, limit);
  const starts: CityPoint[] = [];
  const has: CityPoint[] = [];
  for (const c of gazetteer) {
    if (c.fold.startsWith(q)) starts.push(c);
    else if (c.fold.includes(q)) has.push(c);
    if (starts.length >= limit) break;
  }
  return [...starts, ...has].slice(0, limit);
}
