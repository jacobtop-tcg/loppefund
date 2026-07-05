const BASE = process.env.LOPPEFUND_BASE_URL ?? 'https://jacobtop-tcg.github.io/loppefund';

// Chars that must be escaped when a JSON string is inlined into a <script>:
//   <  >  can close the tag; U+2028 U+2029 are literal line breaks in JS strings.
// The pattern is built from an ASCII string so no literal separator ever lands
// in this source file, and the replacement's backslash comes from a char code
// for the same reason — belt and suspenders against an invisible-char regression.
const SCRIPT_UNSAFE = new RegExp('[<>\\u2028\\u2029]', 'g');
const BACKSLASH = String.fromCharCode(92);

/**
 * Escape a JSON-LD payload for safe inlining in a `<script>` tag. Event text is
 * crawled from the public web, so a title containing "</script>" or a
 * U+2028/U+2029 separator would otherwise break out of the script tag (or the
 * surrounding JS). Each offending char becomes its `\uXXXX` JSON escape.
 */
export function safeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(
    SCRIPT_UNSAFE,
    (c) => BACKSLASH + 'u' + c.charCodeAt(0).toString(16).padStart(4, '0'),
  );
}

/**
 * A CollectionPage → ItemList for a curated set of markets, so Google can
 * present them as a rich list for the high-intent search the page targets
 * ("loppemarked <by>", "loppemarked i weekenden", …) — the surface that most
 * drives a family to open this instead of scrolling Facebook. Capped at 50
 * items, the max Google renders.
 */
export function collectionJsonLd(opts: {
  name: string;
  path: string;
  items: ReadonlyArray<{ slug: string; title: string }>;
}) {
  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: opts.name,
    url: `${BASE}${opts.path}`,
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: opts.items.length,
      itemListElement: opts.items.slice(0, 50).map((e, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        url: `${BASE}/marked/${e.slug}`,
        name: e.title,
      })),
    },
  };
}
