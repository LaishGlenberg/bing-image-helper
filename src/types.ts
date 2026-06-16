/** Result types — plain data, no methods. */

export interface ImageResult {
  /** Where the image was written on disk. */
  path: string;
  /** The URL the image was downloaded from. */
  sourceUrl: string;
  /** Engine name that produced this image ("bing"). */
  engine: string;
  /** The search query string. */
  query: string;
  /** 1-based index within the run (e.g. Image_1.jpg). */
  imageIndex: number;
  /** Size of the saved file in bytes. */
  sizeBytes: number;
  /** Detected MIME type ("image/jpeg", "image/png", etc.). */
  mimeType: string;
}

export interface Result {
  /** The search query. */
  query: string;
  /** Engine name that handled the run. */
  engine: string;
  /** Directory images were written into. */
  outputDir: string;
  /** Every image that was newly saved by this run. */
  images: ImageResult[];
  /** Number of files skipped because they already existed. */
  skipped: number;
  /** (url, error) pairs for each download that failed. */
  errors: Array<{ url: string; error: Error }>;
  /** True if the engine found zero candidate URLs. */
  noResultsFound: boolean;
  /** True if aborted via CancelToken before reaching the limit. */
  cancelled: boolean;
}
