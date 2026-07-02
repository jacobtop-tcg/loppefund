/**
 * Polite HTTP fetcher: per-host rate limiting, robots.txt respect,
 * honest User-Agent, charset-aware decoding (Danish sites are often
 * iso-8859-1). All network access in the pipeline goes through this.
 */
import type { FetchResult } from './adapters/types.ts';

const USER_AGENT =
  'LoppefundBot/0.1 (flea market discovery; respectful crawler)';

interface RobotsRules {
  disallow: string[];
}

export class PoliteFetcher {
  private lastRequestAt = new Map<string, number>();
  private robotsCache = new Map<string, RobotsRules>();
  private minDelayMs: number;

  constructor(opts: { minDelayMs?: number } = {}) {
    this.minDelayMs = opts.minDelayMs ?? 1500;
  }

  async fetch(url: string): Promise<FetchResult> {
    const host = new URL(url).host;
    const rules = await this.robotsFor(host);
    const path = new URL(url).pathname;
    if (rules.disallow.some((prefix) => path.startsWith(prefix))) {
      return { url, status: -1, body: '' }; // blocked by robots.txt
    }
    await this.throttle(host);
    try {
      const res = await globalThis.fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,*/*' },
        redirect: 'follow',
        signal: AbortSignal.timeout(20000),
      });
      const buf = await res.arrayBuffer();
      return { url, status: res.status, body: decodeBody(buf, res.headers.get('content-type')) };
    } catch {
      return { url, status: 0, body: '' };
    }
  }

  private async throttle(host: string): Promise<void> {
    const last = this.lastRequestAt.get(host) ?? 0;
    const wait = last + this.minDelayMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    this.lastRequestAt.set(host, Date.now());
  }

  private async robotsFor(host: string): Promise<RobotsRules> {
    const cached = this.robotsCache.get(host);
    if (cached) return cached;
    let rules: RobotsRules = { disallow: [] };
    try {
      await this.throttle(host);
      const res = await globalThis.fetch(`https://${host}/robots.txt`, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) rules = parseRobots(await res.text());
    } catch {
      // unreachable robots.txt -> assume allowed
    }
    this.robotsCache.set(host, rules);
    return rules;
  }
}

/** Minimal robots.txt parser: Disallow rules in the `User-agent: *` group. */
export function parseRobots(text: string): RobotsRules {
  const disallow: string[] = [];
  let applies = false;
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/#.*/, '').trim();
    const [key, ...rest] = line.split(':');
    if (!key || rest.length === 0) continue;
    const value = rest.join(':').trim();
    if (key.trim().toLowerCase() === 'user-agent') {
      applies = value === '*' || value.toLowerCase().includes('loppefund');
    } else if (applies && key.trim().toLowerCase() === 'disallow' && value) {
      disallow.push(value);
    }
  }
  return { disallow };
}

function decodeBody(buf: ArrayBuffer, contentType: string | null): string {
  let charset = contentType?.match(/charset=([\w-]+)/i)?.[1];
  if (!charset) {
    // sniff <meta charset> in the head
    const head = new TextDecoder('latin1').decode(buf.slice(0, 2048));
    charset =
      head.match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1] ?? 'utf-8';
  }
  try {
    return new TextDecoder(charset).decode(buf);
  } catch {
    return new TextDecoder('utf-8').decode(buf);
  }
}
