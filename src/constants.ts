/** Constants shared across engines. */

/** Extensions we accept when renaming downloaded images. */
export const VALID_IMAGE_EXTENSIONS: ReadonlySet<string> = new Set([
  "jpe",
  "jpeg",
  "jfif",
  "exif",
  "tiff",
  "gif",
  "bmp",
  "png",
  "webp",
  "jpg",
]);

/** Map MIME type to file extension. */
export const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/bmp": "bmp",
  "image/tiff": "tiff",
};

export const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/124.0.0.0 Safari/537.36";

export const DEFAULT_HEADERS: Record<string, string> = {
  "User-Agent": USER_AGENT,
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate",
};
