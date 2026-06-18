/**
 * bing-image-helper — TypeScript SDK
 *
 * @example
 * ```ts
 * // Download images from Bing to disk:
 * import { Bing } from "bing-image-helper";
 * const bing = new Bing({ query: "cats", limit: 5, outputDir: "./cats" });
 * await bing.run();
 *
 * // Get Bing-hosted thumbnail URLs (safe for <img> tags — no 403s):
 * import { searchBingImages } from "bing-image-helper";
 * const results = await searchBingImages({ query: "cats", limit: 10 });
 * // results[0].thumbnailUrl → "https://ts1.mm.bing.net/th?id=..."
 * ```
 *
 * ## Adding a new API / engine
 *
 * 1. Create a new file in `src/` (e.g. `src/google-images.ts`).
 * 2. Export your public types & functions from that module.
 * 3. Add the corresponding `export` lines below in the appropriate section.
 * 4. Run `npm run build` — the package is ready to consume.
 *
 * @packageDocumentation
 */

// ─── Shared types (framework-agnostic) ───────────────────────────────

export type { ImageResult, Result } from "./types.js";

// ─── Debugging (off by default — opt in with debug.enable()) ─────────

export { debug } from "./debug.js";
export type { LogLevel, LogEntry, LogHandler } from "./debug.js";

// ─── Error hierarchy ─────────────────────────────────────────────────

export {
  ImageSaveError,
  NetworkError,
  InvalidImageError,
  DuplicateImageError,
  WriteError,
} from "./errors.js";

// ─── Bing: image download engine ─────────────────────────────────────

export { Bing } from "./bing.js";
export type { BingOptions } from "./bing.js";

// ─── Bing: thumbnail search (Bing-hosted URLs, no hotlinking issues) ─

export { searchBingImages } from "./bing-media.js";
export type { BingImageResult, SearchBingOptions } from "./bing-media.js";
