import { describe, expect, it } from 'vitest';
import { summarizePhotos } from './photos.ts';

describe('summarizePhotos', () => {
  it('keeps valid image entries and normalizes empty credit/date to null', () => {
    const p = summarizePhotos([
      { file: 'broens-lopper-1.jpg', credit: 'Mette', date: '2026-06-01' },
      { file: 'broens-lopper-2.webp', credit: '  ', date: '' },
    ]);
    expect(p).toHaveLength(2);
    expect(p[0]).toEqual({ file: 'broens-lopper-1.jpg', credit: 'Mette', date: '2026-06-01' });
    expect(p[1]).toEqual({ file: 'broens-lopper-2.webp', credit: null, date: null });
  });

  it('rejects path traversal, subpaths, non-images and junk', () => {
    const p = summarizePhotos([
      { file: '../../etc/passwd' },
      { file: 'a/b.jpg' },
      { file: 'evil.js' },
      { file: 'no-extension' },
      { file: '' },
      { credit: 'x' },
      null,
      'nope',
    ]);
    expect(p).toEqual([]);
  });

  it('returns [] for non-array input', () => {
    expect(summarizePhotos(undefined)).toEqual([]);
    expect(summarizePhotos({ file: 'x.jpg' })).toEqual([]);
  });
});
