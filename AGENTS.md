# AGENTS.md — @lglen/bing-image-search

TypeScript SDK for searching and downloading images from Bing. Published as an ESM-only npm package.

## Project structure

```
src/
  index.ts          Barrel exports — the public API surface
  bing.ts           Bing class: downloads images to disk (dedup, resume, atomic writes)
  bing-media.ts     searchBingImages(): returns Bing CDN thumbnail URLs (safe for <img>)
  debug.ts          Centralized debug logger (off by default, custom handlers)
  types.ts          Shared types: ImageResult, Result
  errors.ts         Error hierarchy: ImageSaveError → NetworkError, InvalidImageError, etc.
  constants.ts      Shared constants: valid extensions, MIME map, HTTP headers
  test-bing.ts      Smoke test for the Bing downloader
  test-bing-media.ts Smoke test for the thumbnail search
dist/               Compiled output (emitted by tsc, shipped in the npm package)
```

## Build & tooling

- **TypeScript 6** with `module: nodenext` and `verbatimModuleSyntax`
- **ESM only** — uses `.js` extensions in imports, `"type": "module"` in package.json
- **No bundler** — plain `tsc` emits to `dist/`
- `npm run build` — compile with tsc
- `npm run clean` — wipe build info
- `npm run watch` — tsc in watch mode
- `prepublishOnly` — auto-runs `clean && build` before every `npm publish`

## npm packaging

- `files` field whitelists: `dist/`, `README.md`, `LICENSE`, `CHANGELOG.md`
- `.npmignore` blacklists: `src/`, test files, config files, `.env`
- `exports` map points `"."` → `./dist/index.js` with a `types` conditional for TypeScript consumers
- Test files are excluded from compilation via `tsconfig.json` `exclude`

## The two public APIs

### `Bing` class (src/bing.ts)

- Scrapes Bing Images HTML to extract source URLs (`murl` pattern)
- Downloads each image, validates Content-Type, deduplicates by MD5 hash
- Atomic writes: temp file → rename (avoids partial files on crash)
- Exponential backoff on network errors (2s → 4s → … → 60s max)
- Resume support: skips files already on disk unless `forceReplace: true`
- Filters: `"photo"`, `"clipart"`, `"gif"`, `"transparent"`, `"line"`

**Key options**: `query`, `limit`, `outputDir`, `adult`, `filter`, `forceReplace`, `verbose`, `timeout`, `mkt`, `badsites`, `name`

### `searchBingImages()` (src/bing-media.ts)

- Extracts image metadata from Bing's JSON attributes (`m="{...}"`) in the HTML
- Returns `BingImageResult[]` with `thumbnailUrl` (Bing CDN), `sourceUrl`, `pageUrl`, `title`, `width`, `height`
- Deduplicates by both thumbnail URL and source URL
- Falls back to regex extraction if JSON parsing fails
- **Use case**: embed search results in a website — these URLs don't 403

**Key options**: `query`, `limit`, `adult`, `mkt`, `timeout`

## Debug system (src/debug.ts)

- **Off by default** — zero overhead when disabled
- `debug.enable()` / `debug.disable()` / `debug.setLevel("debug")` — global on/off
- `debug.setHandler(entry => ...)` — replace console output with custom logger (Firebase, pino, winston)
- Each module creates its own logger via `createLogger("moduleName")` with `.debug()`, `.info()`, `.warn()`, `.error()` methods
- The `Bing` class auto-enables debug at `"info"` level when `verbose: true` is passed
- Log levels: `"off"` | `"error"` | `"warn"` | `"info"` | `"debug"` | `"trace"`
- Structured log entries include `timestamp`, `level`, `module`, `message`, `data`
- **Rate-limiting**: consumer-controlled via `debug.enable("trace", { parsed_card_json: 5 })`. Each log message acts as its own identifier — if a limit is configured for that message key, the logger tracks a counter and stops emitting after the limit. The source code uses short snake_case identifiers for noisy per-item trace messages (e.g. `log.trace("parsed_card_json", {...})`). Call `debug.resetCounts()` to reset counters between runs.

## Adding a new API / engine

1. Create a new file in `src/` (e.g. `src/google-images.ts`)
2. Export your public functions and types from that module
3. Add the corresponding export lines in `src/index.ts` under the appropriate section header
4. Run `npm run build` — TypeScript will compile the new module into `dist/` and re-export it from `index.js`
5. The new API is now available to consumers on the next publish

## Coding conventions

- `verbatimModuleSyntax` is on — use `import type` for type-only imports
- File extensions are required in import paths (`.js`, not `.ts` — Node resolution)
- No default exports — all exports are named
- Errors extend `ImageSaveError` with a `reason` discriminator and the failing `url`
- Shared constants live in `constants.ts` (not duplicated across modules)
- All internal logging goes through `createLogger("moduleName")` from `debug.ts` — never use `console.log` directly
- Tests are standalone scripts (not a test framework) — run with `npx tsx src/test-bing.ts`