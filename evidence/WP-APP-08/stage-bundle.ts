// WP-APP-08: write a FRESH bundle of shared/handlers/src/<slug>.ts into a staging copy of functions/<slug>/
// (never into the monorepo folder, which another WP owns). Usage: node --experimental-strip-types stage-bundle.ts <stageDir> <slug>...
import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { bundleText, FUNCTIONS } from "../../shared/handlers/src/_lib/bundle.ts";

const [stage, ...slugs] = process.argv.slice(2);
for (const slug of slugs) {
  const dest = join(stage!, slug);
  mkdirSync(dest, { recursive: true });
  cpSync(join(FUNCTIONS, slug), dest, { recursive: true });
  const text = await bundleText(slug);
  writeFileSync(join(dest, "handler.gen.js"), text);
  console.log(`staged ${slug} (${(text.length / 1024).toFixed(0)} KB)`);
}
