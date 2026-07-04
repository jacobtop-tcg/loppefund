import { describe, expect, it } from 'vitest';
import { googleCalendarUrl } from './calendar.ts';

describe('googleCalendarUrl', () => {
  it('builds a timed Copenhagen event link', () => {
    const url = googleCalendarUrl({
      title: 'Loppemarked på Havnen',
      date: '2026-08-02',
      startTime: '10:00',
      endTime: '16:00',
      location: 'Hornegydén 6, 5600 Faaborg',
      details: 'https://loppefund.dk/marked/x',
    });
    expect(url).toContain('https://calendar.google.com/calendar/render?');
    expect(url).toContain('dates=20260802T100000%2F20260802T160000');
    expect(url).toContain('ctz=Europe%2FCopenhagen');
    expect(url).toContain('text=Loppemarked+p%C3%A5+Havnen');
    expect(url).toContain('location=Hornegyd%C3%A9n');
  });

  it('makes an all-day event when times are unknown (exclusive end date)', () => {
    const url = googleCalendarUrl({ title: 'Marked', date: '2026-12-31', startTime: null, endTime: null });
    expect(url).toContain('dates=20261231%2F20270101');
  });
});
