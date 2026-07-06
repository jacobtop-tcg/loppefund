import { describe, expect, it } from 'vitest';
import { parseFnShop, fetchFolkekirkensNoedhjaelpVenues } from '../src/adapters/folkekirkensnoedhjaelp.ts';

const PAGE = `
  <h1>Genbrugsbutik Rudkøbing</h1>
  <p class="wp-block-paragraph"><strong>Adresse</strong><br><a href="https://maps.app.goo.gl/x">Østergade 17-19 </a><br>5900 Rudkøbing</p>
  <p class="wp-block-paragraph"><strong>Kontakt </strong><br>41277739<br><a href="mailto:genbrug@dca.dk">genbrug@dca.dk</a></p>
  <p class="wp-block-paragraph"><strong>Åbningstider </strong><br>Mandag- Torsdag: 13.00 &#8211; 17.00 <br>Fredag: 10.00 &#8211; 17.00 <br>Lørdag: 10.00 &#8211; 13.00<br>Søndag: Lukket</p>`;
const URL = 'https://www.noedhjaelp.dk/genbrug/genbrugsbutik-rudkobing';

describe('parseFnShop', () => {
  it('parses address and expands day-range hours into a grouped OSM string', () => {
    const v = parseFnShop(PAGE, URL)!;
    expect(v).toMatchObject({
      sourceType: 'fkn',
      operatorToken: 'noedhjaelp',
      title: 'Folkekirkens Nødhjælp, Rudkøbing',
      street: 'Østergade 17-19',
      postcode: '5900',
      city: 'Rudkøbing',
      category: 'genbrug',
    });
    // "Mandag- Torsdag" -> Mo-Th; dots -> colons; Sunday omitted.
    expect(v.openingHoursText).toBe('Mo-Th 13:00-17:00; Fr 10:00-17:00; Sa 10:00-13:00');
  });

  it('gives the same shop a stable id across runs', () => {
    expect(parseFnShop(PAGE, URL)!.sourceId).toBe(parseFnShop(PAGE, URL)!.sourceId);
  });

  it('returns null without a parseable address', () => {
    expect(parseFnShop('<h1>Genbrugsbutik Ingenby</h1>', URL)).toBeNull();
  });
});

describe('fetchFolkekirkensNoedhjaelpVenues', () => {
  it('enumerates /genbrug/genbrugsbutik- URLs from the page sitemap', async () => {
    const sitemap = `<urlset>
      <url><loc>${URL}</loc></url>
      <url><loc>https://www.noedhjaelp.dk/om-os</loc></url>
      <url><loc>https://www.noedhjaelp.dk/genbrug/genbrugsbutik-odense</loc></url>
    </urlset>`;
    const pages: Record<string, string> = {
      'https://www.noedhjaelp.dk/page-sitemap.xml': sitemap,
      [URL]: PAGE,
      'https://www.noedhjaelp.dk/genbrug/genbrugsbutik-odense': PAGE.replace('Rudkøbing', 'Odense'),
    };
    const venues = await fetchFolkekirkensNoedhjaelpVenues({ fetchText: async (u) => pages[u]!, delayMs: 0 });
    // Only the two genbrugsbutik URLs are fetched (the /om-os page is ignored).
    expect(venues).toHaveLength(2);
    expect(venues.every((v) => v.sourceType === 'fkn')).toBe(true);
  });
});
