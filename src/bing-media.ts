/**
 * Bing image search → Bing-hosted thumbnail URLs.
 *
 * Unlike bing.ts (which tries to download from source hosts and gets 403'd),
 * this extracts the **Bing CDN thumbnail URLs** from search results.
 * These are served by Bing itself — no hotlinking issues, works everywhere.
 *
 * Use case: display search results on your own site via <img> tags.
 *
 * Example:
 *   const results = await searchBing("cats", 10);
 *   // results[0].thumbnailUrl → "https://ts1.mm.bing.net/th?id=..."
 *   // <img src={results[0].thumbnailUrl} />
 */

const PAGE_SIZE = 35;

const HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: "https://www.bing.com/",
};

export interface BingImageResult {
  /** Bing's cached thumbnail URL — always works, use in <img> tags. */
  thumbnailUrl: string;
  /** The original source URL (may 403 if the host blocks hotlinking). */
  sourceUrl: string;
  /** The webpage URL that contains this image (the page it links to). */
  pageUrl: string;
  /** Title/alt text from the search result. */
  title: string;
  /** Width of the full image in pixels (0 if unknown). */
  width: number;
  /** Height of the full image in pixels (0 if unknown). */
  height: number;
}

export interface SearchBingOptions {
  query: string;
  /** Max results (default 35, max ~1000). */
  limit?: number;
  /** Adult filter: "off" or "moderate" (default). */
  adult?: string;
  /** Market code (default "en-US"). */
  mkt?: string;
  /** Timeout per request in seconds (default 30). */
  timeout?: number;
}

/**
 * Search Bing Images and return Bing-hosted thumbnail URLs.
 * These URLs are safe to embed in <img> tags — no 403 hotlinking issues.
 */
export async function searchBingImages(
  options: SearchBingOptions,
): Promise<BingImageResult[]> {
  const {
    query,
    limit = 35,
    adult = "moderate",
    mkt = "en-US",
    timeout = 30,
  } = options;

  const results: BingImageResult[] = [];
  let page = 0;
  const seenSourceUrls = new Set<string>();
  const seenThumbUrls = new Set<string>();

  while (results.length < limit) {
    const url = buildPageUrl(query, page, adult, mkt);

    let html: string;
    try {
      const resp = await fetch(url, {
        headers: HEADERS,
        signal: AbortSignal.timeout(timeout * 1000),
      });
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }
      html = await resp.text();
    } catch (e) {
      // Network error or timeout — try next page after brief pause
      if (page < 5) {
        page++;
        await sleep(1000);
        continue;
      }
      break;
    }

    // Parse each image card from the HTML
    const cards = parseImageCards(html);

    if (cards.length === 0) break;

    for (const card of cards) {
      if (results.length >= limit) break;

      // Dedupe by thumbnail URL (Bing sometimes repeats)
      const thumbKey = card.turl ?? card.murl;
      if (!thumbKey || seenThumbUrls.has(thumbKey)) continue;

      const sourceUrl = card.murl ?? "";
      if (sourceUrl && seenSourceUrls.has(sourceUrl)) continue;

      if (sourceUrl) seenSourceUrls.add(sourceUrl);
      if (thumbKey) seenThumbUrls.add(thumbKey);

      results.push({
        thumbnailUrl: card.turl ?? sourceUrl,
        sourceUrl,
        pageUrl: card.purl ?? "",
        title: card.desc ?? "",
        width: card.width ?? 0,
        height: card.height ?? 0,
      });
    }

    // If we got fewer results than page size, we're probably at the end
    if (cards.length < PAGE_SIZE) break;

    page++;
    if (page > 28) break; // safety: ~1000 results max
  }

  return results;
}

// ─── Internal helpers ───────────────────────────────────────────────

interface ImageCard {
  murl?: string; // source URL
  turl?: string; // Bing thumbnail URL
  purl?: string; // page URL (the webpage containing the image)
  desc?: string; // title/alt text
  width?: number;
  height?: number;
}

function parseImageCards(html: string): ImageCard[] {
  const cards: ImageCard[] = [];

  // Bing wraps each image result with an m="{...}" JSON attribute.
  // The JSON uses &quot; for quotes (HTML-encoded).
  const cardRe = /m="\{&quot;[^}]*\}"/g;

  for (const match of html.matchAll(cardRe)) {
    try {
      // Extract JSON string, decode HTML entities, unescape
      const raw = match[0]
        .slice(3, -1) // strip `m="` and trailing `"`
        .replace(/&quot;/g, '"')
        .replace(/\\u0026/g, "&")
        .replace(/&amp;/g, "&");
      const m = JSON.parse(raw);
      const card: ImageCard = {};

      if (m.murl) card.murl = m.murl;
      if (m.turl) card.turl = m.turl;
      if (m.purl) card.purl = m.purl;
      if (m.desc) card.desc = m.desc;
      if (m.w) card.width = Number(m.w);
      if (m.h) card.height = Number(m.h);

      cards.push(card);
    } catch {
      // Skip malformed entries
    }
  }

  // Fallback: if the JSON approach didn't work, regex the turl/murl/purl directly.
  if (cards.length === 0) {
    const murls = [...html.matchAll(/murl&quot;:&quot;(.*?)&quot;/g)].map(
      (m) => m[1],
    );
    const turls = [...html.matchAll(/turl&quot;:&quot;(.*?)&quot;/g)]
      .map((m) => m[1])
      .filter(Boolean);
    const purls = [...html.matchAll(/purl&quot;:&quot;(.*?)&quot;/g)]
      .map((m) => m[1])
      .filter(Boolean);

    for (let i = 0; i < Math.max(murls.length, turls.length, purls.length); i++) {
      cards.push({
        murl: murls[i] ?? undefined,
        turl: turls[i] ?? undefined,
        purl: purls[i] ?? undefined,
      });
    }
  }

  return cards;
}

function buildPageUrl(
  query: string,
  page: number,
  adult: string,
  mkt: string,
): string {
  return (
    "https://www.bing.com/images/async?q=" +
    encodeURIComponent(query) +
    "&first=" +
    (page * PAGE_SIZE) +
    "&count=" +
    PAGE_SIZE +
    "&adlt=" +
    adult +
    "&mkt=" +
    encodeURIComponent(mkt) +
    "&qft="
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
