/**
 * Self-hosted Facebook harvester — the free, no-Apify alternative.
 *
 * WHY: the local flea markets that never reach a public calendar (Dyreborg,
 * Horne, Faaborg Havn …) are announced in Facebook groups. Apify can scrape
 * them but costs money; this does the same from YOUR machine, on a residential
 * IP Facebook doesn't instantly block, using a browser session you control.
 *
 * WHAT IT DOES: opens the group/search URLs you list, collects the visible
 * post text + permalink + any timestamp, and writes them as the exact JSON the
 * `facebook-feed` adapter already ingests (posts -> parseTip, events ->
 * eventToRaw). No pipeline change is needed — you point the pipeline at the
 * output file's URL.
 *
 * HOW TO USE (on your own machine, NOT in CI — FB blocks datacenter IPs):
 *   1. npm i -D playwright  &&  npx playwright install chromium
 *   2. Make a DEDICATED Facebook account (never your personal one — automation
 *      can get an account limited), and join the public loppe-groups you want.
 *   3. Configure the targets in fb-harvest.config.json (see the sample the
 *      script writes on first run), then:
 *        node scripts/fb-harvest.mjs --login     # one-time: log in by hand
 *        node scripts/fb-harvest.mjs             # harvest -> data/fb-harvest.json
 *   4. Publish data/fb-harvest.json where the pipeline can fetch it (commit it
 *      and use its raw URL, or any static host), then set
 *        LOPPEFUND_FB_FEED_URLS=<that url>
 *      The next crawl ingests it, dedupes against everything else, and shows
 *      the markets at trust 0.4 ("ubekræftet" until a second source confirms).
 *
 * CAVEATS (be honest): this automates Facebook, which is against their ToS —
 * appropriate for public market announcements for your own directory, but use
 * the throwaway account, keep it slow/polite (this script does), and expect to
 * re-tune the selectors when FB changes its DOM. It only reads PUBLIC posts you
 * can already see; it never posts, messages, or scrapes private data.
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync, unlinkSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..');
const CONFIG = resolve(ROOT, 'scripts/fb-harvest.config.json');
const SESSION_DIR = resolve(ROOT, '.fb-session'); // persistent login, gitignored
const OUT = resolve(ROOT, 'data/fb-harvest.json');
const OCR_SCRIPT = resolve(ROOT, 'scripts/ocr.swift');

// Most loppe-group market announcements are POSTER IMAGES — the date/place/name
// live in the picture, not the caption. On a Mac, Apple's Vision framework OCRs
// them for free (excellent Danish) via scripts/ocr.swift. Verified end-to-end:
// a real "Loppemarked lørdag d. 4.7 kl. 10-14 … Sankt Nicolai Gade 2a" poster
// OCRs cleanly and the pipeline turns it into a dated, located event. Returns
// '' on any platform without Swift/Vision, so the harvester degrades to text.
const OCR_ENABLED = existsSync(OCR_SCRIPT);
function ocrImage(pngPath) {
  try {
    return execFileSync('swift', [OCR_SCRIPT, pngPath], { encoding: 'utf8', timeout: 30000 }).trim();
  } catch {
    return '';
  }
}

const SAMPLE_CONFIG = {
  // Real Danish loppe-groups to start from (your dedicated account must JOIN
  // each one first — group posts are only readable to members). Sydfyn-first,
  // since that is the known coverage gap, plus the national group. Add/remove
  // freely; harvest is polite/slow, so keep the list focused.
  targets: [
    { type: 'group', url: 'https://www.facebook.com/groups/1575345569157850/', scrolls: 8, note: 'Loppemarked Sydfyn' },
    { type: 'group', url: 'https://www.facebook.com/groups/836925897344099/', scrolls: 8, note: 'Loppemarked Svendborg' },
    { type: 'group', url: 'https://www.facebook.com/groups/849539698483803/', scrolls: 8, note: 'Små og store loppemarkeder på Fyn' },
    { type: 'group', url: 'https://www.facebook.com/groups/1434236776796925/', scrolls: 6, note: 'Loppemarked På Fyn' },
    { type: 'group', url: 'https://www.facebook.com/groups/363166350422631/', scrolls: 6, note: 'Private og offentlige loppemarkeder på Fyn' },
    // Area-specific (Faaborg / Langeland) — where the very local markets live:
    { type: 'group', url: 'https://www.facebook.com/groups/317275305707909/', scrolls: 6, note: 'Horne Kræmmermarked (Faaborg)' },
    { type: 'group', url: 'https://www.facebook.com/groups/2750518275077822/', scrolls: 6, note: 'Lopper og flittige hænder på Langeland' },
    { type: 'page', url: 'https://www.facebook.com/LoppeladenFaaborg', scrolls: 4, note: 'Loppeladen Faaborg (page)' },
    // Nationwide/regional groups joined 2026-07-03 (biggest reach):
    { type: 'group', url: 'https://www.facebook.com/groups/362315834415/', scrolls: 8, note: 'Loppemarkeder i Danmark (44k)' },
    { type: 'group', url: 'https://www.facebook.com/groups/607762852587305/', scrolls: 8, note: 'Loppemarked FYN (27k, 90+ posts/dag)' },
    { type: 'group', url: 'https://www.facebook.com/groups/721174666810053/', scrolls: 8, note: 'MarkedsKALENDEREN (30k)' },
    { type: 'group', url: 'https://www.facebook.com/groups/1484631705148044/', scrolls: 6, note: 'Loppemarkeder i Sønderjylland' },
    { type: 'group', url: 'https://www.facebook.com/groups/785478073645748/', scrolls: 6, note: 'Loppemarkeder i København' },
    { type: 'group', url: 'https://www.facebook.com/groups/259660774155532/', scrolls: 6, note: 'Loppemarkeder på Fyn (privat — afventer godkendelse)' },
    { type: 'group', url: 'https://www.facebook.com/groups/1674550122762082/', scrolls: 6, note: 'Loppemarked oversigt Sjælland (privat — afventer godkendelse)' },
    // Facebook's own event search casts a wider net once you are logged in:
    { type: 'search', url: 'https://www.facebook.com/events/search?q=loppemarked', scrolls: 4, note: 'FB events: loppemarked' },
    { type: 'search', url: 'https://www.facebook.com/events/search?q=kr%C3%A6mmermarked', scrolls: 4, note: 'FB events: kræmmermarked' },
    // Marketplace: mostly single items, but occasional market flyers slip in —
    // OCR + the date filter keep only genuine markets. Lower yield than groups.
    { type: 'marketplace', url: 'https://www.facebook.com/marketplace/search?query=loppemarked', scrolls: 3, note: 'Marketplace: loppemarked' },
    { type: 'marketplace', url: 'https://www.facebook.com/marketplace/search?query=kr%C3%A6mmermarked', scrolls: 3, note: 'Marketplace: kræmmermarked' },
    { type: 'marketplace', url: 'https://www.facebook.com/marketplace/search?query=bagagerumsmarked', scrolls: 2, note: 'Marketplace: bagagerumsmarked' },
  ],
  // Only keep posts that look market-related, to keep the feed clean.
  keywords: ['loppemarked', 'kræmmermarked', 'kraemmermarked', 'bagagerumsmarked', 'genbrugsmarked', 'antikmarked', 'stadeplads', 'stadeleje', 'kræmmer'],
};

async function loadConfig() {
  if (!existsSync(CONFIG)) {
    await writeFile(CONFIG, JSON.stringify(SAMPLE_CONFIG, null, 2));
    console.log(`Wrote a sample config to ${CONFIG} — edit its "targets" and re-run.`);
    process.exit(0);
  }
  return JSON.parse(await readFile(CONFIG, 'utf8'));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const login = process.argv.includes('--login');
  const cfg = await loadConfig();
  const keywords = (cfg.keywords ?? SAMPLE_CONFIG.keywords).map((k) => k.toLowerCase());

  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    console.error('Playwright not installed. Run:  npm i -D playwright && npx playwright install chromium');
    process.exit(1);
  }

  // Persistent context = the login survives between runs (like a real browser).
  // The stealth touches (real UA, no AutomationControlled flag, hidden
  // navigator.webdriver) are the same trick paid scrapers use — on your own
  // residential IP they make an ordinary logged-in session look ordinary.
  const ctx = await chromium.launchPersistentContext(SESSION_DIR, {
    headless: !login,
    viewport: { width: 1280, height: 900 },
    locale: 'da-DK',
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    args: ['--disable-blink-features=AutomationControlled'],
  });
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
  const page = ctx.pages()[0] ?? (await ctx.newPage());

  if (login) {
    await page.goto('https://www.facebook.com/');
    console.log('Log in with your DEDICATED account in the opened window, then press Enter here…');
    await new Promise((r) => process.stdin.once('data', r));
    await ctx.close();
    console.log('Session saved. Re-run without --login to harvest.');
    return;
  }

  const items = [];
  const seen = new Set();

  // Screenshot the biggest image in an element and OCR it (the poster/flyer,
  // where FB posts AND Marketplace listings hide the date/place). '' if none.
  async function ocrOf(handle, idHint) {
    if (!OCR_ENABLED) return '';
    try {
      const img = await handle.$('img');
      const box = img && (await img.boundingBox());
      if (!box || box.width < 200 || box.height < 200) return '';
      const tmp = join(tmpdir(), `fbimg-${idHint.replace(/\W+/g, '').slice(0, 40)}.png`);
      try {
        await img.screenshot({ path: tmp });
        return ocrImage(tmp);
      } finally {
        try { unlinkSync(tmp); } catch { /* already gone */ }
      }
    } catch {
      return ''; // detached node / no image — text-only
    }
  }

  // Keep an item only if it mentions a market keyword and has usable text.
  function keep(id, text, url, iso) {
    if (seen.has(id) || !text || text.replace(/\s+/g, ' ').trim().length < 15) return;
    if (!keywords.some((k) => text.toLowerCase().includes(k))) return;
    seen.add(id);
    items.push({ id: id.replace(/\W+/g, '').slice(0, 32), text, url, startDate: iso ?? undefined });
  }

  for (const t of cfg.targets ?? []) {
    if (/REPLACE_WITH/.test(t.url)) continue;
    try {
      console.log(`[harvest] ${t.type ?? 'group'}: ${t.url}`);
      await page.goto(t.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await sleep(3000);
      for (let s = 0; s < (t.scrolls ?? 5); s++) {
        if (t.type === 'marketplace') {
          // Marketplace listings are /marketplace/item/ links with a photo. The
          // few that are actually market announcements (not single items) carry
          // the date/place in a flyer image, so OCR it; parseTip then drops any
          // listing without a real date, keeping only genuine markets.
          for (const card of await page.$$('a[href*="/marketplace/item/"]')) {
            const d = await card.evaluate((el) => ({
              url: el.href.split('?')[0],
              text: (el.innerText || '').trim(),
            }));
            const id = 'mp' + (d.url.match(/item\/(\d+)/)?.[1] ?? d.url);
            if (seen.has(id)) continue;
            // Drop the leading price token ("Free", "DKK50", "$200", "50 kr")
            // so a passing listing's title isn't "Free Loppemarked …".
            const title = d.text.replace(/^(?:Free|Gratis|DKK[\d.,]+|\$[\d.,]+|[\d.,]+\s*kr\.?)\s+/i, '');
            const ocr = await ocrOf(card, id);
            keep(id, ocr ? `${title}\n${ocr}` : title, d.url, null);
          }
        } else {
          // Group/page/search posts: read the caption + OCR the poster image.
          for (const art of await page.$$('[role="article"]')) {
            const d = await art.evaluate((el) => {
              const text = (el.innerText || '').trim();
              let url = null;
              for (const a of el.querySelectorAll('a[href*="/posts/"],a[href*="/events/"],a[href*="permalink"]')) {
                if (a.href) { url = a.href.split('?')[0]; break; }
              }
              const tm = el.querySelector('abbr[data-utime],[data-visualcompletion] time,time');
              return { text, url, iso: tm?.getAttribute('datetime') || null };
            });
            const id = (d.url ?? d.text).slice(0, 200);
            if (!d.text || seen.has(id)) continue;
            const ocr = await ocrOf(art, id);
            keep(id, ocr ? `${d.text}\n${ocr}` : d.text, d.url ?? t.url, d.iso);
          }
        }
        await page.mouse.wheel(0, 2400);
        await sleep(2500 + Math.random() * 1500); // polite, human-ish pacing
      }
    } catch (e) {
      console.warn(`[harvest] ${t.url} failed: ${e.message}`);
    }
  }

  await ctx.close();
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(items, null, 2));
  console.log(`\nHarvested ${items.length} market-related posts -> ${OUT}`);
  console.log('Publish that file and set LOPPEFUND_FB_FEED_URLS to its URL, then run the pipeline.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
