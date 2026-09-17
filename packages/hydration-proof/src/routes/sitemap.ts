// Sitemap reading: robots.txt `Sitemap:` lines, sitemap indexes and URL sets.

export type FetchText = (url: string) => Promise<string | undefined>;

const LOC = /<loc>\s*([^<]+?)\s*<\/loc>/gi;

function decodeXml(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function locations(xml: string): string[] {
  return [...xml.matchAll(LOC)].map((match) => decodeXml(match[1]!));
}

export interface SitemapResult {
  /** Paths (with query) found in the sitemaps. */
  paths: string[];
  /** Sitemap files that were read. */
  sources: string[];
}

/**
 * Read sitemaps starting at `start` (a sitemap URL), or at robots.txt and
 * /sitemap.xml of `baseUrl` when `start` is undefined. Hosts in the sitemap
 * are ignored: sitemaps usually list the production domain, while tests run
 * against another host.
 */
export async function readSitemaps(baseUrl: string, fetchText: FetchText, start?: string, limit = 500): Promise<SitemapResult> {
  const queue: { url: string; depth: number }[] = [];
  if (start) {
    queue.push({ url: new URL(start, `${baseUrl}/`).href, depth: 0 });
  } else {
    const robots = await fetchText(`${baseUrl}/robots.txt`);
    for (const line of robots?.split(/\r?\n/) ?? []) {
      const match = /^\s*sitemap:\s*(\S+)/i.exec(line);
      if (match) queue.push({ url: rebase(match[1]!, baseUrl), depth: 0 });
    }
    if (queue.length === 0) queue.push({ url: `${baseUrl}/sitemap.xml`, depth: 0 });
  }

  const seen = new Set<string>();
  const paths = new Set<string>();
  const sources: string[] = [];
  while (queue.length > 0 && paths.size < limit) {
    const { url, depth } = queue.shift()!;
    if (seen.has(url)) continue;
    seen.add(url);
    const xml = await fetchText(url);
    if (!xml || !/<(?:urlset|sitemapindex)\b/i.test(xml)) continue;
    sources.push(url);
    if (/<sitemapindex\b/i.test(xml)) {
      if (depth >= 3) continue;
      for (const child of locations(xml)) queue.push({ url: rebase(child, baseUrl), depth: depth + 1 });
      continue;
    }
    for (const loc of locations(xml)) {
      try {
        const parsed = new URL(loc, `${baseUrl}/`);
        paths.add(`${parsed.pathname}${parsed.search}`);
      } catch {
        // Not a URL; skip.
      }
      if (paths.size >= limit) break;
    }
  }
  return { paths: [...paths], sources };
}

/** Point an absolute sitemap URL at the tested host. */
function rebase(url: string, baseUrl: string): string {
  try {
    const parsed = new URL(url, `${baseUrl}/`);
    const base = new URL(baseUrl);
    parsed.protocol = base.protocol;
    parsed.host = base.host;
    return parsed.href;
  } catch {
    return url;
  }
}
