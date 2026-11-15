// WP-APP-08: checks the hardened linked-slug rewrite in app/app/vite.config.ts. Run from app/app:
//   npx tsx ../../evidence/WP-APP-08/vite-rewrite-check.mts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const { rewriteLinkedSlugs } = await import(process.cwd() + "/vite.config.ts");
const C = "/x/src/lib/client.ts", A = "/x/src/App.tsx";
assert.equal(rewriteLinkedSlugs(C, "invokeFunction(`${appSlug}/${slug}`, {"), "invokeFunction(slug, {");
assert.equal(rewriteLinkedSlugs(A, "open(`merc/merc-live?client=${c}`)"), "open(`merc-live?client=${c}`)");
assert.equal(rewriteLinkedSlugs(C, "opts.invoker.invokeFunction(slug, {"), null);          // fixed upstream: no-op
assert.throws(() => rewriteLinkedSlugs(C, "invokeFunction(qualify(slug), {"), /neither/);   // shape changed: fail build
assert.throws(() => rewriteLinkedSlugs(A, "open(`merc/merc-live?client=`); f('merc/me')"), /still present/);
assert.equal(rewriteLinkedSlugs("/x/src/other.ts", "'merc/me'"), null);                   // other files untouched
for (const [f, p] of [["src/lib/client.ts", C], ["src/App.tsx", A]] as const) assert.ok(rewriteLinkedSlugs(p, readFileSync(f, "utf8")) !== undefined);
console.log("vite-rewrite-check: 7 assertions passed");
