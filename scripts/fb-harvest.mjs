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
import { fileURLToPath } from 'node:url';

// fileURLToPath (not URL.pathname) so a repo path with spaces/special chars —
// e.g. ".../Loppemarkeder i DK" — is decoded, not left percent-encoded (%20).
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * ACCUMULATE, NEVER REPLACE.
 *
 * Every run is a PARTIAL, non-deterministic sample of Facebook: the time budget
 * cuts it short, and FB serves different posts each visit. So the harvest is a
 * sample, never an enumeration. Overwriting the feed with one sample silently
 * drops every market the run happened not to scroll past — measured once at
 * 70 real upcoming markets lost and 157 events expired in a single run.
 *
 * The feed is therefore a UNION keyed on the post's stable id, and entries only
 * ever leave it by AGE (their day is long past), never by absence from a run.
 * Fresher text for a known id wins, so a corrected/updated post still updates.
 */
const HARVEST_KEEP_DAYS = 400;

export function harvestKey(item) {
  return String(item.id ?? item.url ?? item.postUrl ?? item.text ?? '').slice(0, 120);
}

/** Newest date this item refers to, for ageing out; null when undated. */
function harvestDate(item) {
  const iso = item.startDate ?? item.endDate ?? null;
  return typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : null;
}

export function mergeHarvest(existing, fresh, today = new Date().toISOString().slice(0, 10)) {
  const cutoff = new Date(Date.parse(`${today}T00:00:00Z`) - HARVEST_KEEP_DAYS * 86400000)
    .toISOString()
    .slice(0, 10);
  const byKey = new Map();
  for (const item of [...(existing ?? []), ...(fresh ?? [])]) {
    const key = harvestKey(item);
    if (!key) continue;
    byKey.set(key, item); // fresh wins on a re-seen id
  }
  // Drop only what is genuinely stale-by-date. Undated posts are kept: a
  // recurring "hver søndag" announcement has no date but is still true.
  return [...byKey.values()].filter((i) => {
    const d = harvestDate(i);
    return d === null || d >= cutoff;
  });
}

async function readExistingHarvest(path) {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8'));
    return Array.isArray(parsed) ? parsed : (parsed.items ?? []);
  } catch {
    return []; // first run, or an unreadable file — start clean
  }
}
const CONFIG = resolve(ROOT, 'scripts/fb-harvest.config.json');
const SESSION_DIR = resolve(ROOT, '.fb-session'); // persistent login, gitignored
// Output path. Defaults to the committed feed the pipeline ingests, but can be
// redirected (FB_HARVEST_OUT) to a scratch file so a raw run doesn't clobber a
// hand-curated feed before its markets have been verified and merged back in.
const OUT = resolve(ROOT, process.env.FB_HARVEST_OUT ?? 'data/fb-harvest.json');
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
    // Facebook EVENT SEARCH is by far the richest, best-structured source — clean
    // dates + addresses. Proven: one broad run yielded 130 verified markets. Cast
    // wide by market type AND by region (q accepts "loppemarked <by>"):
    { type: 'search', url: 'https://www.facebook.com/events/search?q=loppemarked', scrolls: 5, note: 'FB events: loppemarked' },
    { type: 'search', url: 'https://www.facebook.com/events/search?q=kr%C3%A6mmermarked', scrolls: 5, note: 'FB events: kræmmermarked' },
    { type: 'search', url: 'https://www.facebook.com/events/search?q=bagagerumsmarked', scrolls: 4, note: 'FB events: bagagerumsmarked' },
    { type: 'search', url: 'https://www.facebook.com/events/search?q=genbrugsmarked', scrolls: 3, note: 'FB events: genbrugsmarked' },
    { type: 'search', url: 'https://www.facebook.com/events/search?q=loppemarked%20k%C3%B8benhavn', scrolls: 4, note: 'FB events: loppemarked København' },
    { type: 'search', url: 'https://www.facebook.com/events/search?q=loppemarked%20aarhus', scrolls: 4, note: 'FB events: loppemarked Aarhus' },
    { type: 'search', url: 'https://www.facebook.com/events/search?q=loppemarked%20odense', scrolls: 4, note: 'FB events: loppemarked Odense' },
    { type: 'search', url: 'https://www.facebook.com/events/search?q=loppemarked%20aalborg', scrolls: 4, note: 'FB events: loppemarked Aalborg' },
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
// Human-ish randomness (no fixed cadence — constant timing is a bot tell).
const rand = (min, max) => Math.floor(min + Math.random() * (max - min));
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

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
  // Anti-detection is mostly BEHAVIOURAL (see the harvest loop: shuffled order,
  // long randomized gaps between groups, human-ish scrolling, checkpoint backoff).
  // The launch touches just make the browser itself look ordinary:
  //  - channel 'chrome' = your real installed Chrome (best fingerprint), not the
  //    bundled "Chrome for Testing"; falls back to bundled chromium if absent.
  //  - HEADED by default for harvest too — a real, visible Chrome window is far
  //    less bot-like than headless (set FB_HARVEST_HEADLESS=1 to override).
  //  - real UA, Europe/Copenhagen tz, da-DK locale, no AutomationControlled flag,
  //    hidden navigator.webdriver.
  const headless = login ? false : process.env.FB_HARVEST_HEADLESS === '1';
  const launchOpts = {
    headless,
    viewport: { width: 1280, height: 900 },
    locale: 'da-DK',
    timezoneId: 'Europe/Copenhagen',
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    args: ['--disable-blink-features=AutomationControlled'],
  };
  let ctx;
  try {
    ctx = await chromium.launchPersistentContext(SESSION_DIR, { ...launchOpts, channel: 'chrome' });
  } catch {
    ctx = await chromium.launchPersistentContext(SESSION_DIR, launchOpts); // bundled chromium fallback
  }
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });
  const page = ctx.pages()[0] ?? (await ctx.newPage());

  if (login) {
    await page.goto('https://www.facebook.com/');
    console.log('Opened Facebook — log in in the window. I detect the session automatically (no Enter needed).');
    // Facebook sets a `c_user` cookie (your numeric account id) once you are
    // authenticated. Poll for it so login works UNATTENDED — no interactive
    // stdin/Enter needed, which lets this run in the background while you log in
    // by hand in the popped-up window. Give up after 6 minutes.
    const deadline = Date.now() + 6 * 60 * 1000;
    let ok = false;
    while (Date.now() < deadline) {
      await sleep(2500);
      const cookies = await ctx.cookies('https://www.facebook.com');
      if (cookies.some((c) => c.name === 'c_user' && c.value)) { ok = true; break; }
    }
    if (ok) await sleep(1500); // let FB finish writing session cookies to disk
    await ctx.close();
    console.log(ok
      ? 'Login detected — session saved to .fb-session. Re-run without --login to harvest.'
      : 'Timed out waiting for login; no session saved.');
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

  // OCR one image element directly. Poster-first harvesting: FB obfuscates post
  // text (per-character reordered spans) and [role=article] is unreliable, so the
  // FLYER IMAGE is the dependable carrier of date/place/name. Size + aspect gate
  // skips avatars/reactions (too small) and full-viewport overlay imgs / banners
  // (too big or too wide) that would otherwise OCR the page chrome.
  async function ocrImgHandle(img, idHint) {
    if (!OCR_ENABLED) return '';
    try {
      const box = await img.boundingBox();
      if (!box || box.width < 260 || box.height < 260) return '';
      const area = box.width * box.height;
      const ar = box.width / box.height;
      if (area > 1_000_000 || ar > 2.2 || ar < 0.45) return '';
      const tmp = join(tmpdir(), `fbimg-${idHint.replace(/\W+/g, '').slice(0, 40)}.png`);
      try {
        await img.screenshot({ path: tmp });
        return ocrImage(tmp);
      } finally {
        try { unlinkSync(tmp); } catch { /* already gone */ }
      }
    } catch {
      return '';
    }
  }

  // Keep an item only if it mentions a market keyword and has usable text.
  function keep(id, text, url, iso) {
    if (seen.has(id) || !text || text.replace(/\s+/g, ' ').trim().length < 15) return;
    if (!keywords.some((k) => text.toLowerCase().includes(k))) return;
    seen.add(id);
    items.push({ id: id.replace(/\W+/g, '').slice(0, 32), text, url, startDate: iso ?? undefined });
  }

  // Anti-bot: warm up like a real session before touching any group.
  const RUN_BUDGET_MS = Number(process.env.FB_HARVEST_BUDGET_MS ?? 25 * 60 * 1000);
  const startedAt = Date.now();
  try { await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 30000 }); } catch { /* ignore */ }
  await sleep(rand(4000, 8000));

  // Visit targets in RANDOM order with long human gaps between them (the single
  // most important anti-bot measure) and stop at a per-run wall-clock budget.
  let aborted = false;
  for (const t of shuffle([...(cfg.targets ?? [])].filter((x) => !/REPLACE_WITH/.test(x.url)))) {
    if (aborted || Date.now() - startedAt > RUN_BUDGET_MS) {
      console.log('[harvest] stopping (time budget reached or backed off).');
      break;
    }
    try {
      console.log(`[harvest] ${t.type ?? 'group'}: ${t.url}`);
      await page.goto(t.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await sleep(rand(2500, 4500));
      // Checkpoint / rate-limit wall → back off immediately (never hammer).
      const blocked = await page.evaluate(() => {
        const b = (document.body.innerText || '').toLowerCase().slice(0, 500);
        return /checkpoint|you're temporarily blocked|going too fast|confirm your identity|log ind for at forts/.test(location.href.toLowerCase() + ' ' + b);
      }).catch(() => false);
      if (blocked) { console.warn('[harvest] checkpoint/throttle detected — backing off, ending run.'); aborted = true; break; }
      for (let s = 0; s < (t.scrolls ?? 5); s++) {
        if (t.type === 'marketplace') {
          // Read EVERY listing card in ONE pass. Marketplace virtualizes hard, so
          // per-card awaits (the old approach) raced with node recycling — a
          // detached node threw and aborted the whole target, which is why
          // Marketplace silently yielded nothing. The aria-label carries the clean
          // "<title>, <price>, <location>, listing <id>"; strip price + the
          // "listing N" tail. No OCR here (thumbnails are cropped and were the
          // detachment source); parseTip drops the many undated single-item/shop
          // listings and keeps only ones whose title states a real date.
          const listings = await page.evaluate(() => {
            const out = [];
            for (const a of document.querySelectorAll('a[href*="/marketplace/item/"]')) {
              const m = a.href.match(/item\/(\d+)/);
              if (!m) continue;
              out.push({ id: m[1], url: a.href.split('?')[0], text: (a.getAttribute('aria-label') || a.innerText || '').trim() });
            }
            return out;
          });
          for (const l of listings) {
            const id = 'mp' + l.id;
            if (seen.has(id)) continue;
            const cleaned = l.text
              .replace(/(?:Free|Gratis|DKK[\d.,]+|\$[\d.,]+|[\d.,]+\s*kr\.?)/gi, '')
              .replace(/,?\s*listing\s+\d+\s*$/i, '')
              .split(',').map((x) => x.trim()).filter(Boolean).join(', ');
            keep(id, cleaned, l.url, null);
          }
        } else {
          // Group/page/search posts: clean captions (event cards, some posts) via
          // [role=article] text — a cheap supplement when FB isn't obfuscating.
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
            keep(id, d.text, d.url ?? t.url, d.iso);
          }
          // PRIMARY path — OCR every poster-sized image on the page. This is what
          // actually surfaces the markets: the flyer picture carries the date,
          // place and name in a form OCR reads cleanly, regardless of FB's text
          // obfuscation or article structure. parseTip drops any without a date.
          for (const img of await page.$$('img')) {
            let src;
            try { src = await img.evaluate((el) => (el.currentSrc || el.src || '').split('?')[0]); } catch { continue; }
            if (!src) continue;
            const id = 'fbimg' + src.slice(-64);
            if (seen.has(id)) continue;
            // Attach the nearest post/photo permalink if one is in an ancestor.
            let url = t.url;
            try {
              url = (await img.evaluate((el) => {
                for (let n = el, i = 0; n && i < 12; i++, n = n.parentElement) {
                  const a = n.querySelector?.('a[href*="/posts/"],a[href*="/permalink/"],a[href*="/photo"]');
                  if (a?.href) return a.href.split('?')[0];
                }
                return null;
              })) || t.url;
            } catch { /* keep target url */ }
            const ocr = await ocrImgHandle(img, id);
            keep(id, ocr, url, null);
            seen.add(id); // processed — never OCR this image again this run
          }
        }
        // human-ish scroll: variable distance, small mouse move, and an
        // occasional longer "reading" pause. FB lazy-loads on real scroll events.
        await page.mouse.move(rand(300, 1000), rand(300, 800)).catch(() => {});
        await page.evaluate((dy) => window.scrollBy(0, dy), rand(1200, 2200)).catch(() => {});
        await page.mouse.wheel(0, rand(1000, 1800));
        await sleep(rand(2800, 6000) + (Math.random() < 0.15 ? rand(3000, 7000) : 0));
      }
    } catch (e) {
      console.warn(`[harvest] ${t.url} failed: ${e.message}`);
    }
    // Long, randomized gap BETWEEN groups — the key behavioural anti-bot measure.
    await sleep(rand(12000, 25000));
  }

  await ctx.close();
  await mkdir(dirname(OUT), { recursive: true });
  const merged = mergeHarvest(await readExistingHarvest(OUT), items);
  await writeFile(OUT, JSON.stringify(merged, null, 2));
  console.log(
    `\nHarvested ${items.length} market-related posts this run` +
      ` -> ${merged.length} in the accumulated feed (${OUT})`,
  );
  console.log('Publish that file and set LOPPEFUND_FB_FEED_URLS to its URL, then run the pipeline.');
}

// Only harvest when RUN as a script. Without this guard a plain `import` of
// this file (a unit test of mergeHarvest, say) silently opens a real Facebook
// session — an automated login nobody asked for, against an account FB can
// limit for exactly that. Importing must be inert; harvesting must be explicit.
const isEntryPoint = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntryPoint) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
