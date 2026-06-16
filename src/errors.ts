/** Typed error hierarchy for image-save failures. */

export class ImageSaveError extends Error {
  readonly reason: string;
  readonly url: string;

  constructor(reason: string, url: string, message?: string) {
    super(message ?? `image save failed: reason=${reason} url=${url}`);
    this.name = "ImageSaveError";
    this.reason = reason;
    this.url = url;
  }
}

export class NetworkError extends ImageSaveError {
  constructor(url: string, message?: string) {
    super("network", url, message ?? `network error fetching ${url}`);
    this.name = "NetworkError";
  }
}

export class InvalidImageError extends ImageSaveError {
  constructor(url: string, message?: string) {
    super("invalid_image", url, message ?? `invalid image body at ${url}`);
    this.name = "InvalidImageError";
  }
}

export class DuplicateImageError extends ImageSaveError {
  constructor(url: string, message?: string) {
    super("duplicate", url, message ?? `duplicate image (same MD5) at ${url}`);
    this.name = "DuplicateImageError";
  }
}

export class WriteError extends ImageSaveError {
  constructor(url: string, message?: string) {
    super("write_failed", url, message ?? `failed to write image at ${url}`);
    this.name = "WriteError";
  }
}
