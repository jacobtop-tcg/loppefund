import { describe, expect, it } from 'vitest';
import { parseGoerlevDates, goerlevMarked } from '../src/adapters/goerlev-marked.ts';
import type { FetchResult } from '../src/adapters/types.ts';

// Mirrors the real page: two "uge N den …" market windows + an edit timestamp.
const PAGE =
  'Markedet holdes i uge 27 den 3. - 5. juli. Redigeret den 5. januar 2025. ' +
  'Efterårsmarked i uge 37 den 11.- 13. september.';

describe('parseGoerlevDates', () => {
  it('extracts both market windows and ignores the edit timestamp', () => {
    expect(parseGoerlevDates(PAGE, 2026).map((o) => o.date)).toEqual([
      '2026-07-03',
      '2026-07-04',
      '2026-07-05',
      '2026-09-11',
      '2026-09-12',
      '2026-09-13',
    ]);
  });

  it('honours an explicit year and leaves times null', () => {
    const occ = parseGoerlevDates('marked i uge 27 den 3.-5. juli 2027', 2026);
    expect(occ.map((o) => o.date)).toEqual(['2027-07-03', '2027-07-04', '2027-07-05']);
    expect(occ.every((o) => o.startTime === null)).toBe(true);
  });
});

describe('goerlevMarked adapter', () => {
  it('returns Gørlev market with parsed windows', async () => {
    const raws = await goerlevMarked.fetchRawEvents!(async () => ({ url: 'x', status: 200, body: PAGE }));
    expect(raws).toHaveLength(1);
    const r = raws[0]!;
    expect(r.category).toBe('kraemmermarked');
    expect(r.postcode).toBe('4281');
    expect(r.city).toBe('Gørlev');
    expect((r.occurrences ?? []).length).toBe(6);
  });

  it('emits nothing when the page announces no market window', async () => {
    expect(
      await goerlevMarked.fetchRawEvents!(async () => ({ url: 'x', status: 200, body: 'Redigeret den 5. januar 2025' })),
    ).toEqual([]);
  });
});
