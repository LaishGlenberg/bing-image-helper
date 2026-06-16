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
} from "./constants.js";

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
    this.verbose = options.verbose ?? true;
    this.badsites = new Set(options.badsites ?? []);
    this.imageName = options.name ?? "Image";
    this.forceReplace = options.forceReplace ?? false;
    this.mkt = options.mkt ?? "en-US";
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
    const url = this.buildPageUrl(page);
    const resp = await fetch(url, {
      headers: {
        ...DEFAULT_HEADERS,
        Referer: "https://www.bing.com/",
      },
      signal: AbortSignal.timeout(this.timeout * 1000),
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
      try {
        return new TextDecoder().decode(gunzipSync(buf));
      } catch {
        // Already decompressed by fetch — decode as-is
      }
    }
    return new TextDecoder().decode(buf);
  }

  // ─── Extract image URLs from Bing HTML ────────────────────────────

  private extractLinks(html: string): string[] {
    const re = /murl&quot;:&quot;(.*?)&quot;/g;
    return [...html.matchAll(re)].map((m) => m[1]);
  }

  // ─── Main run loop ────────────────────────────────────────────────

  async run(): Promise<void> {
    await mkdir(this.outputDir, { recursive: true });

    let pageCounter = 0;
    let slotsUsed = 0;

    while (slotsUsed < this.limit) {
      if (this.verbose) {
        console.log(`\n[!] Indexing page: ${pageCounter + 1}`);
      }

      // Fetch page
      let html: string;
      try {
        html = await this.fetchPage(pageCounter);
      } catch (e) {
        if (e instanceof NetworkError) {
          const wait = this.consumeBackoff();
          console.error(
            `Network error requesting Bing: ${e.message}. Retrying in ${wait.toFixed(1)}s.`,
          );
          await sleep(wait * 1000);
          continue;
        }
        console.error(`Unexpected error: ${e}`);
        break;
      }

      if (!html) {
        console.log("[%] No more images are available");
        this.noResultsFound = true;
        break;
      }

      // Extract + filter links
      const links = this.extractLinks(html);
      if (this.verbose) {
        console.log(
          `[%] Indexed ${links.length} Images on Page ${pageCounter + 1}.`,
        );
      }

      const filtered = links.filter(
        (link) =>
          !this.seen.has(link) &&
          ![...this.badsites].some((bs) => link.includes(bs)),
      );
      if (filtered.length === 0) {
        console.log("[%] No new images are available");
        break;
      }
      for (const link of filtered) this.seen.add(link);

      const remaining = this.limit - slotsUsed;
      const toDownload = filtered.slice(0, remaining);
      const slotsBefore = slotsUsed;

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
        console.warn("No images could be downloaded from this page");
        break;
      }

      if (slotsUsed >= this.limit) break;
      pageCounter++;
      this.backoff = BACKOFF_INITIAL;
    }

    if (this.verbose) {
      console.log(`\n[%] Done. Downloaded ${this.images.length} images.`);
    }
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
      ext = "jpg"; // fallback
    }

    const filePath = join(
      this.outputDir,
      `${this.imageName}_${index}.${ext}`,
    );

    // Resume: skip if file already exists
    if (!this.forceReplace) {
      try {
        const stat = await import("node:fs/promises").then((fs) =>
          fs.stat(filePath),
        );
        if (stat.isFile()) {
          if (this.verbose) {
            console.log(`Skipping already-downloaded image #${index}`);
          }
          this.skipped++;
          return "skip";
        }
      } catch {
        // File doesn't exist — proceed
      }
    }

    if (this.verbose) {
      console.log(`Downloading Image #${index} from ${link}`);
    }

    try {
      await this.saveImage(link, filePath);
      if (this.verbose) {
        console.log(`Downloaded File #${index}`);
      }
      return "ok";
    } catch (e) {
      this.errors.push({ url: link, error: e as Error });
      if (this.verbose) {
        console.error(`Issue getting image ${link}: ${(e as Error).message}`);
      }
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
      if (!resp.ok) {
        throw new NetworkError(
          link,
          `HTTP ${resp.status} ${resp.statusText}`,
        );
      }
    } catch (e) {
      if (e instanceof NetworkError) throw e;
      throw new NetworkError(link, `fetch error: ${(e as Error).message}`);
    }

    const image = new Uint8Array(await resp.arrayBuffer());

    // Validate MIME type from Content-Type header
    const contentType = resp.headers.get("Content-Type") ?? "";
    if (!contentType.startsWith("image/")) {
      throw new InvalidImageError(link);
    }

    // MD5 dedup
    const fileHash = createHash("md5").update(image).digest("hex");
    if (this.fileHashes.has(fileHash)) {
      throw new DuplicateImageError(link);
    }
    this.fileHashes.add(fileHash);

    // Determine extension from MIME, update filePath if needed
    const ext = MIME_TO_EXT[contentType.split(";")[0]] ?? "jpg";
    const finalPath = filePath.replace(/\.[^.]+$/, `.${ext}`);

    // Atomic write: temp file → rename
    const tmpPath = join(tmpdir(), `.tmp_${basename(finalPath)}_${Date.now()}`);
    try {
      await writeFile(tmpPath, image);
      await rename(tmpPath, finalPath);
    } catch (e) {
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
    this.images.push({
      path: finalPath,
      sourceUrl: link,
      engine: "bing",
      query: this.query,
      imageIndex: this.images.length + 1,
      sizeBytes: image.byteLength,
      mimeType: contentType.split(";")[0],
    });
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
