/**
 * Standardized trace-log event identifiers.
 *
 * Every rate-limitable `log.trace(...)` call in the SDK uses one of these
 * instead of a raw string. Consumers reference the same object when
 * configuring limits:
 *
 * ```ts
 * import { TraceEvents } from "@lglen/bing-image-search";
 * debug.enable("trace", {
 *   [TraceEvents.BingMedia.ParsedCardJson]: 5,
 *   [TraceEvents.Bing.AcceptedResult]: 20,
 * });
 * ```
 *
 * Non-trace logs (debug / info / warn / error) use free-form messages
 * and are **not** rate-limited — only trace-level events use these IDs.
 *
 * @packageDocumentation
 */

export const TraceEvents = {
  // ─── bing-media.ts ────────────────────────────────────────────────

  BingMedia: {
    /** Emitted for every JSON image card parsed from Bing's HTML. High volume — cap aggressively. */
    ParsedCardJson: "parsed_card_json",
    /** A card's JSON failed to parse. Usually rare unless Bing changes markup. */
    SkippedMalformedCard: "skipped_malformed_card",
    /** Card skipped because its thumbnail URL was already seen. */
    DedupedThumbnail: "deduped_thumbnail",
    /** Card skipped because its source URL was already seen. */
    DedupedSource: "deduped_source",
    /** Card accepted into the final result set. */
    AcceptedResult: "accepted_result",
  },

  // ─── bing.ts (download engine) ────────────────────────────────────

  Bing: {
    /** Link filtered — already crawled in this run. */
    FilteredSeen: "filtered_seen",
    /** Link filtered — matched a badsites entry. */
    FilteredBadsite: "filtered_badsite",
    /** URL path extension not recognized — falling back to .jpg. */
    ExtFallback: "ext_fallback",
    /** Derived output file path for an image being downloaded. */
    TargetFilePath: "target_file_path",
    /** Resume: file already exists on disk, skipping. */
    FileExists: "file_exists",
    /** Resume: file not on disk, will download. */
    FileNotFound: "file_not_found",
    /** forceReplace is enabled — will overwrite. */
    ForceReplace: "force_replace",
    /** HTTP response metadata from the image source host. */
    FetchResponse: "fetch_response",
    /** Fetch threw an error that is NOT a NetworkError. */
    FetchError: "fetch_error",
    /** Content-Type header was not image/*. */
    InvalidContentType: "invalid_content_type",
    /** MD5 hash computed for a downloaded image. */
    ComputedMd5: "computed_md5",
    /** MIME type → file extension resolution result. */
    ResolvedExt: "resolved_ext",
    /** Temp-write + rename details (atomic write). */
    AtomicWrite: "atomic_write",
    /** Write or rename failed (before error is thrown). */
    WriteFailed: "write_failed",
    /** ImageResult pushed onto bing.images[]. */
    RecordedResult: "recorded_result",
  },
} as const;

/** Union of every trace event ID string. */
export type TraceEventId =
  | (typeof TraceEvents.BingMedia)[keyof typeof TraceEvents.BingMedia]
  | (typeof TraceEvents.Bing)[keyof typeof TraceEvents.Bing];
