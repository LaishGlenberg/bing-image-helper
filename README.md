# @lglen/bing-image-search

TypeScript SDK for searching and downloading images from Bing. ESM only.

## Install

```bash
npm install @lglen/bing-image-search
```

## API

### `searchBingImages(options)` — get Bing-hosted thumbnails

Returns thumbnail URLs served directly by Bing's CDN — safe to embed in `<img>` tags, no hotlinking issues.

```ts
import { searchBingImages } from "@lglen/bing-image-search";

const results = await searchBingImages({
  query: "sunset landscape",
  limit: 10,
  adult: "moderate",  // default
  mkt: "en-US",       // default
});

console.log(`Found ${results.length} results:\n`);

for (const r of results) {
  console.log(`  Title: ${r.title || "(none)"}`);
  console.log(`  Source: ${r.sourceUrl.substring(0, 100)}...`);
  console.log(`  Thumb:  ${r.thumbnailUrl.substring(0, 100)}...`);
  console.log(`  Page:  ${r.pageUrl.substring(0, 100)}...`);
  console.log(`  Size:   ${r.width}x${r.height}`);
  console.log();
}
```

### `Bing` class — download images to disk

Fetches images from source hosts and saves them locally with deduplication and resume support.

```ts
import { Bing } from "@lglen/bing-image-search";

const bing = new Bing({
  query: "kittens",
  limit: 20,
  outputDir: "./downloads/kittens",
  adult: "moderate",
  filter: "photo",        // "photo" | "clipart" | "gif" | "transparent" | "line"
  forceReplace: false,    // skip already-downloaded files
  verbose: true,
});

await bing.run();

// Results after run:
console.log(bing.images);   // ImageResult[] — saved files
console.log(bing.skipped);  // number already on disk
console.log(bing.errors);   // { url, error }[] — failed downloads
```

### Error types

All download errors extend `ImageSaveError`:
`NetworkError` · `InvalidImageError` · `DuplicateImageError` · `WriteError`

```ts
import { ImageSaveError, NetworkError } from "@lglen/bing-image-search";
```

### Debugging

Debug logging is **off by default**. Enable it to see internal requests, parsed data, and errors:

```ts
import { debug } from "@lglen/bing-image-search";

debug.enable("trace", {
  parsed_card_json: 5,    // cap the per-card JSON parse log at 5 entries
  accepted_result: 20,    // cap accepted results at 20
  deduped_thumbnail: 10,  // only 10 dedupe messages
});

// Reset counters between runs:
debug.resetCounts();
```

**Custom handler** — for Firebase Cloud Functions or structured logging:

```ts
debug.setHandler((entry) => {
  // entry.timestamp, entry.level, entry.module, entry.message, entry.data
  console.log(JSON.stringify(entry));
});
```

Levels: `"off"` | `"error"` | `"warn"` | `"info"` | `"debug"` | `"trace"`

> **Tip:** "trace" level logs are rate-limited internally to avoid flooding — noisy per-item logs auto-cap at 5–20 entries. Call `debug.resetCounts()` to reset the caps between runs.

## License

MIT