/**
 * Smoke test for bing-media.ts — Bing-hosted thumbnails.
 * Run: npx tsx src/test-bing-media.ts
 */

import { searchBingImages } from "./bing-media.js";
import { debug } from "./debug.js";

async function main() {
  debug.enable('trace');
  const queries = ["cats"];

  for (const query of queries) {
    console.log(`\n=== "${query}" ===\n`);
    const results = await searchBingImages({ query, limit: 2 });

    console.log(`Found ${results.length} results:\n`);

    for (const r of results) {
      console.log(`  Title: ${r.title || "(none)"}`);
      console.log(`  Source: ${r.sourceUrl.substring(0, 100)}...`);
      console.log(`  Thumb:  ${r.thumbnailUrl.substring(0, 100)}...`);
      console.log(`  Page:  ${r.pageUrl.substring(0, 100)}...`);
      console.log(`  Size:   ${r.width}x${r.height}`);
      console.log();
    }
  }
}

main().catch(console.error);
