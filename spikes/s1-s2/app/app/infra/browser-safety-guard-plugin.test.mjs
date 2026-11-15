// Regression tests for the browser-safety guard.
//
// The guard's job is to fail a production build that would ship a Node-only
// reference and die on load in the browser with "process is not defined". Its
// other job, equally important, is NOT to fail a build over a string that
// merely contains one of those words — a generated app's own copy and code
// samples are full of them, and a false positive here blocks the app with a
// message that points at nothing.
//
// Run with `pnpm test` (node's built-in runner; no extra test framework).

import assert from "node:assert/strict";
import { test } from "node:test";
import { createBrowserSafetyGuardPlugin } from "./browser-safety-guard-plugin.ts";

/**
 * Run the plugin's generateBundle over one emitted chunk and return the build
 * error it raised, or null when it let the chunk through.
 */
function check(code, fileName = "app.js") {
	const plugin = createBrowserSafetyGuardPlugin();
	// The plugin parses with vite's own parser, so the context only has to carry
	// `error` — exactly what the real build gives it.
	const context = {
		error: (message) => {
			throw new Error(typeof message === "string" ? message : message.message);
		},
	};
	try {
		plugin.generateBundle.call(context, {}, {
			[fileName]: { type: "chunk", code },
		});
	} catch (error) {
		return error.message;
	}
	return null;
}

test("rejects the Node-only references that crash an app on load", () => {
	assert.match(check(`const x = require("node:fs");`), /CommonJS `require\(` call/);
	assert.match(check(`if (process.env.NODE_ENV) {}`), /Node `process\.\*` access/);
	assert.match(check(`module.exports = {};`), /CommonJS `module\.exports`/);
	assert.match(check(`const p = __dirname;`), /Node path global/);
	assert.match(check(`const p = __filename;`), /Node path global/);
});

test("rejects the bundler's require stand-in for a CJS dependency", () => {
	// What Rolldown emits when a bundled CJS module requires an external such as
	// react: the app dies on load with "Calling `require` for "react"".
	const shim = `var z = function(e) { if (typeof require < "u") return require.apply(this, arguments); throw Error("x"); };`;
	assert.match(check(shim), /CommonJS `require\(` call/);
	assert.equal(check(`export const ok = typeof require;`), null);
});

test("accepts an app whose STRINGS contain those words", () => {
	// The reason the guard reads syntax instead of text. Each of these aborted
	// the build under the old text scan.
	assert.equal(check(`export const t = "Finish the onboarding process. Then review it.";`), null);
	assert.equal(check(`export const sample = "const fs = require('fs')";`), null);
	assert.equal(check(`export const doc = \`Set module.exports to the handler\`;\n`), null);
	assert.equal(check(`export const help = "__dirname is a Node global";`), null);
	assert.equal(check(`// process.env is folded by the production define\nexport const a = 1;`), null);
});

test("accepts a property that merely shares the name", () => {
	// `a.process` and `{ process: ... }` are ordinary members, not the global.
	assert.equal(check(`export const a = config.process;`), null);
	assert.equal(check(`export const a = { process: 1, __dirname: 2 };`), null);
	assert.equal(check(`export const a = steps.require;`), null);
	// …but a computed read of the real global is still a read of it.
	assert.match(check(`export const a = process["env"];`), /Node `process\.\*` access/);
});

test("ignores non-JS assets and asset entries", () => {
	assert.equal(check(`require("fs")`, "styles.css"), null);
	const plugin = createBrowserSafetyGuardPlugin();
	const context = {
		error: () => assert.fail("an asset must not be parsed as code"),
	};
	plugin.generateBundle.call(context, {}, {
		"logo.svg": { type: "asset", source: "require(" },
	});
});

test("fails loudly when a chunk cannot be parsed, rather than passing it", () => {
	assert.match(check(`this is not javascript (((`), /could not be parsed/);
});
