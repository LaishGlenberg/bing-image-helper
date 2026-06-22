/**
 * Bing image search engine.
 * Port of python/better_bing_image_downloader/bing.py
 */

import { createHash } from "node:crypto";
import { rename, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, extname } from "node:path";
import { gunzipSync } from "node:zlib";
import type { ImageResult } from "./types.js";
import {
  NetworkError,
  InvalidImageError,
  DuplicateImageError,
  WriteError,
} from "./errors.js";
import {
  VALID_IMAGE_EXTENSIONS,
  MIME_TO_EXT,
  DEFAULT_HEADERS,
  applyRelay,
} from "./constants.js";
import { createLogger, debug } from "./debug.js";
import { TraceEvents } from "./trace-events.js";

const log = createLogger("bing");
const T = TraceEvents.Bing;
const TS = TraceEvents.Shared;

const PAGE_SIZE = 35;
const BACKOFF_INITIAL = 2.0;
const BACKOFF_FACTOR = 2.0;
const BACKOFF_MAX = 60.0;

export interface BingOptions {
  query: string;
  limit: number;
  outputDir: string;
  adult?: string;
  timeout?: number;
  filter?: string;
  verbose?: boolean;
  badsites?: string[];
  name?: string;
  forceReplace?: boolean;
  mkt?: string;
  /**
   * Proxy all Bing search requests through this relay URL.
   * The relay must accept `GET <relayUrl>?url=<encodedBingUrl>`.
   * Image downloads from source hosts go direct — only Bing search calls are relayed.
   * @example "https://abc123.ngrok-free.app/bing"
   */
  relayUrl?: string;
  /** Optional client IP to include in debug logs (for diagnosing region-specific issues). */
  clientIp?: string;
}

export class Bing {
  readonly query: string;
  readonly limit: number;
  readonly outputDir: string;
  readonly adult: string;
  readonly timeout: number;
  readonly filter: string;
  readonly verbose: boolean;
  readonly badsites: Set<string>;
  readonly imageName: string;
  readonly forceReplace: boolean;
  readonly mkt: string;
  readonly relayUrl?: string;
  readonly clientIp?: string;

  private seen: Set<string> = new Set();
  private fileHashes: Set<string> = new Set();
  private backoff: number = BACKOFF_INITIAL;

  // Results accumulated during this run
  images: ImageResult[] = [];
  skipped = 0;
  errors: Array<{ url: string; error: Error }> = [];
  noResultsFound = false;
  cancelled = false;

  constructor(options: BingOptions) {
    this.query = options.query;
    this.limit = options.limit;
    this.outputDir = options.outputDir;
    this.adult = options.adult ?? "moderate";
    this.timeout = options.timeout ?? 60;
    this.filter = options.filter ?? "";
    this.verbose = options.verbose ?? false;
    this.badsites = new Set(options.badsites ?? []);
    this.imageName = options.name ?? "Image";
    this.forceReplace = options.forceReplace ?? false;
    this.mkt = options.mkt ?? "en-US";
    this.relayUrl = options.relayUrl;
    this.clientIp = options.clientIp;

    // Wire verbose into the global debug system so consumers
    // can set a custom handler and still see Bing download logs.
    if (this.verbose && debug.getLevel() === "off") {
      debug.enable("info");
    }
  }

  // ─── filter shorthand → Bing filterui string ──────────────────────

  private getFilter(shorthand: string): string {
    const filters: Record<string, string> = {
      line: "+filterui:photo-linedrawing",
      linedrawing: "+filterui:photo-linedrawing",
      photo: "+filterui:photo-photo",
      clipart: "+filterui:photo-clipart",
      gif: "+filterui:photo-animatedgif",
      animatedgif: "+filterui:photo-animatedgif",
      transparent: "+filterui:photo-transparent",
    };
    return filters[shorthand] ?? "";
  }

  // ─── URL building ─────────────────────────────────────────────────

  private buildPageUrl(page: number): string {
    return (
      "https://www.bing.com/images/async?q=" +
      encodeURIComponent(this.query) +
      "&first=" +
      (page * PAGE_SIZE) +
      "&count=" +
      PAGE_SIZE +
      "&adlt=" +
      this.adult +
      "&mkt=" +
      encodeURIComponent(this.mkt) +
      "&qft=" +
      (this.filter ? this.getFilter(this.filter) : "")
    );
  }

  // ─── Fetch a single Bing results page ─────────────────────────────

  private async fetchPage(page: number): Promise<string> {
    const bingUrl = this.buildPageUrl(page);
    const url = applyRelay(bingUrl, this.relayUrl);
    log.trace("Fetching Bing page", { page, bingUrl: bingUrl.substring(0, 200), url: url.substring(0, 200) });

    const resp = await fetch(url, {
      headers: {
        ...DEFAULT_HEADERS,
        Referer: "https://www.bing.com/",
      },
      signal: AbortSignal.timeout(this.timeout * 1000),
    });

    log.trace("Bing page response", {
      page,
      status: resp.status,
      statusText: resp.statusText,
      contentType: resp.headers.get("content-type"),
      contentEncoding: resp.headers.get("content-encoding"),
      contentLength: resp.headers.get("content-length"),
    });

    if (!resp.ok) {
      throw new NetworkError(url, `HTTP ${resp.status} ${resp.statusText}`);
    }

    // Node's fetch handles content-encoding transparently, so just
    // read as text. If the response somehow comes through raw+gzip,
    // fall back to manual gunzip.
    const buf = new Uint8Array(await resp.arrayBuffer());
    const enc = resp.headers.get("Content-Encoding");
    if (enc === "gzip") {
      log.trace("Manually gunzipping response", { page });
      try {
        const decoded = new TextDecoder().decode(gunzipSync(buf));
        log.trace("HTML after gunzip", { page, length: decoded.length, preview: decoded.substring(0, 400) });
        return decoded;
      } catch {
        log.trace("Gunzip failed — treating as already decompressed", { page });
      }
    }
    const html = new TextDecoder().decode(buf);
    log.trace("HTML decoded", { page, length: html.length, preview: html.substring(0, 400) });
    return html;
  }

  // ─── Extract image URLs from Bing HTML ────────────────────────────

  private extractLinks(html: string): string[] {
    const re = /murl&quot;:&quot;(.*?)&quot;/g;
    const links = [...html.matchAll(re)].map((m) => m[1]);
    log.trace("Extracted source URLs", {
      count: links.length,
      samples: links.slice(0, 5).map((l) => l.substring(0, 120)),
    });
    return links;
  }

  // ─── Main run loop ────────────────────────────────────────────────

  async run(): Promise<void> {
    log.trace(TS.SearchContext, {
      query: this.query,
      relayUrl: this.relayUrl,
      clientIp: this.clientIp,
    });
    log.trace("Bing download run starting", {
      query: this.query,
      limit: this.limit,
      outputDir: this.outputDir,
      adult: this.adult,
      timeout: this.timeout,
      filter: this.filter,
      forceReplace: this.forceReplace,
      verbose: this.verbose,
      mkt: this.mkt,
      badsites: [...this.badsites],
      imageName: this.imageName,
    });
    await mkdir(this.outputDir, { recursive: true });

    let pageCounter = 0;
    let slotsUsed = 0;

    while (slotsUsed < this.limit) {
      log.info(`Indexing page ${pageCounter + 1}`, { query: this.query });

      // Fetch page
      let html: string;
      try {
        html = await this.fetchPage(pageCounter);
      } catch (e) {
        if (e instanceof NetworkError) {
          const wait = this.consumeBackoff();
          log.warn("Network error — retrying", {
            error: e.message,
            retryInSec: wait,
            page: pageCounter,
          });
          await sleep(wait * 1000);
          continue;
        }
        log.error("Unexpected error fetching page", {
          error: String(e),
          page: pageCounter,
        });
        break;
      }

      if (!html) {
        log.info("No more images available — empty response");
        this.noResultsFound = true;
        break;
      }

      // Extract + filter links
      const links = this.extractLinks(html);
      log.info(`Indexed ${links.length} images on page ${pageCounter + 1}`);

      const filtered = links.filter(
        (link) => {
          const alreadySeen = this.seen.has(link);
          const isBadsite = [...this.badsites].some((bs) => link.includes(bs));
          if (alreadySeen) {
            log.trace(T.FilteredSeen, { url: link.substring(0, 120) });
          }
          if (isBadsite) {
            log.trace(T.FilteredBadsite, { url: link.substring(0, 120) });
          }
          return !alreadySeen && !isBadsite;
        },
      );
      log.trace("Link filtering stats", {
        page: pageCounter,
        total: links.length,
        kept: filtered.length,
        seen: this.seen.size,
        badsites: [...this.badsites],
      });
      if (filtered.length === 0) {
        log.info("No new images available on this page");
        break;
      }
      for (const link of filtered) this.seen.add(link);

      const remaining = this.limit - slotsUsed;
      const toDownload = filtered.slice(0, remaining);
      const slotsBefore = slotsUsed;

      log.trace("Download batch", {
        page: pageCounter,
        toDownload: toDownload.length,
        remaining,
        slotsUsed,
        totalLimit: this.limit,
        urls: toDownload.map((l) => l.substring(0, 100)),
      });

      for (const link of toDownload) {
        if (slotsUsed >= this.limit) break;
        const idx = this.images.length + this.skipped + 1;
        const result = await this.downloadImage(link, idx);
        if (result === "ok") {
          slotsUsed++;
        } else if (result === "skip") {
          slotsUsed++;
        }
        // result === "fail" → doesn't consume a slot
      }

      if (slotsUsed === slotsBefore) {
        log.warn("No images could be downloaded from this page");
        break;
      }

      if (slotsUsed >= this.limit) break;
      pageCounter++;
      this.backoff = BACKOFF_INITIAL;
    }

    log.info("Download run complete", {
      downloaded: this.images.length,
      skipped: this.skipped,
      errors: this.errors.length,
    });
  }

  // ─── Download a single image ──────────────────────────────────────

  private async downloadImage(
    link: string,
    index: number,
  ): Promise<"ok" | "skip" | "fail"> {
    // Determine filename + extension
    const urlPath = link.split("?")[0];
    let ext = extname(urlPath).replace(".", "").toLowerCase();

    if (!VALID_IMAGE_EXTENSIONS.has(ext)) {
      log.trace(T.ExtFallback, {
        originalExt: ext,
        urlPath: urlPath.substring(0, 120),
      });
      ext = "jpg"; // fallback
    }

    const filePath = join(
      this.outputDir,
      `${this.imageName}_${index}.${ext}`,
    );

    log.trace(T.TargetFilePath, { index, filePath, ext, sourceUrl: link.substring(0, 120) });

    // Resume: skip if file already exists
    if (!this.forceReplace) {
      try {
        const stat = await import("node:fs/promises").then((fs) =>
          fs.stat(filePath),
        );
        if (stat.isFile()) {
          log.info(`Skipping existing image #${index}`);
          log.trace(T.FileExists, { filePath, size: stat.size });
          this.skipped++;
          return "skip";
        }
      } catch {
        log.trace(T.FileNotFound, { filePath });
      }
    } else {
      log.trace(T.ForceReplace, { filePath });
    }

    log.debug(`Downloading image #${index}`, { url: link });

    try {
      await this.saveImage(link, filePath);
      log.debug(`Downloaded image #${index}`);
      return "ok";
    } catch (e) {
      this.errors.push({ url: link, error: e as Error });
      log.warn(`Download failed for image #${index}`, {
        url: link,
        error: (e as Error).message,
      });
      return "fail";
    }
  }

  // ─── Save an image to disk atomically ─────────────────────────────

  private async saveImage(link: string, filePath: string): Promise<void> {
    // Fetch the image bytes
    let resp: Response;
    try {
      resp = await fetch(link, {
        headers: {
          ...DEFAULT_HEADERS,
          Referer: "https://www.bing.com/",
        },
        signal: AbortSignal.timeout(this.timeout * 1000),
      });

      log.trace(T.FetchResponse, {
        url: link.substring(0, 120),
        status: resp.status,
        statusText: resp.statusText,
        contentType: resp.headers.get("content-type"),
        contentLength: resp.headers.get("content-length"),
        contentDisposition: resp.headers.get("content-disposition"),
      });

      if (!resp.ok) {
        throw new NetworkError(
          link,
          `HTTP ${resp.status} ${resp.statusText}`,
        );
      }
    } catch (e) {
      if (e instanceof NetworkError) throw e;
      log.trace(T.FetchError, {
        url: link.substring(0, 120),
        error: (e as Error).message,
        errorType: (e as Error).constructor.name,
      });
      throw new NetworkError(link, `fetch error: ${(e as Error).message}`);
    }

    const image = new Uint8Array(await resp.arrayBuffer());

    // Validate MIME type from Content-Type header
    const contentType = resp.headers.get("Content-Type") ?? "";
    log.debug("Image fetched", {
      url: link.substring(0, 100),
      size: image.byteLength,
      contentType,
      status: resp.status,
    });
    if (!contentType.startsWith("image/")) {
      log.trace(T.InvalidContentType, {
        url: link.substring(0, 120),
        contentType,
      });
      throw new InvalidImageError(link);
    }

    // MD5 dedup
    const fileHash = createHash("md5").update(image).digest("hex");
    log.trace(T.ComputedMd5, { hash: fileHash, url: link.substring(0, 100) });
    if (this.fileHashes.has(fileHash)) {
      log.debug("Duplicate image skipped (MD5)", { url: link.substring(0, 100) });
      throw new DuplicateImageError(link);
    }
    this.fileHashes.add(fileHash);

    // Determine extension from MIME, update filePath if needed
    const ext = MIME_TO_EXT[contentType.split(";")[0]] ?? "jpg";
    const finalPath = filePath.replace(/\.[^.]+$/, `.${ext}`);

    log.trace(T.ResolvedExt, {
      contentType,
      ext,
      requestedPath: filePath,
      finalPath,
    });

    // Atomic write: temp file → rename
    const tmpPath = join(tmpdir(), `.tmp_${basename(finalPath)}_${Date.now()}`);
    log.trace(T.AtomicWrite, { tmpPath, finalPath, size: image.byteLength });
    try {
      await writeFile(tmpPath, image);
      await rename(tmpPath, finalPath);
      log.debug("Image saved", { path: finalPath, size: image.byteLength });
    } catch (e) {
      log.trace(T.WriteFailed, {
        tmpPath,
        finalPath,
        error: (e as Error).message,
      });
      // Clean up temp file on failure
      try {
        await import("node:fs/promises").then((fs) => fs.unlink(tmpPath));
      } catch {
        /* best effort */
      }
      throw new WriteError(
        link,
        `write failed: ${(e as Error).message}`,
      );
    }

    // Record success
    const result: ImageResult = {
      path: finalPath,
      sourceUrl: link,
      engine: "bing",
      query: this.query,
      imageIndex: this.images.length + 1,
      sizeBytes: image.byteLength,
      mimeType: contentType.split(";")[0],
    };
    log.trace(T.RecordedResult, result);
    this.images.push(result);
  }

  // ─── Backoff helpers ──────────────────────────────────────────────

  private consumeBackoff(): number {
    const wait = this.backoff;
    this.backoff = Math.min(this.backoff * BACKOFF_FACTOR, BACKOFF_MAX);
    return wait;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
