/**
 * better-bing-image-downloader — TypeScript port
 *
 * Download images from Bing (to disk):
 *   import { Bing } from "better-bing-image-downloader";
 *   const bing = new Bing({ query: "cats", limit: 5, outputDir: "./cats" });
 *   await bing.run();
 *
 * Get Bing-hosted thumbnail URLs (for <img> tags — no 403s):
 *   import { searchBingImages } from "better-bing-image-downloader";
 *   const results = await searchBingImages({ query: "cats", limit: 10 });
 *   // results[0].thumbnailUrl → "https://ts1.mm.bing.net/th?id=..."
 */

// Download engine
export { Bing } from "./bing.js";
export type { BingOptions } from "./bing.js";

// Bing-hosted thumbnails (no hotlinking issues)
export { searchBingImages } from "./bing-media.js";
export type { BingImageResult, SearchBingOptions } from "./bing-media.js";

// Shared types
export type { ImageResult, Result } from "./types.js";

export {
  ImageSaveError,
  NetworkError,
  InvalidImageError,
  DuplicateImageError,
  WriteError,
} from "./errors.js";
