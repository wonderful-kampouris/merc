// Regression tests for the layout guard: an app that renders a component
// removed in @wonderful/ui-base 4 must fail its build with the migration, not
// paint a blank screen with "Element type is invalid".
//
// Run with `pnpm test` (node's built-in runner; no extra test framework).

import assert from "node:assert/strict";
import { test } from "node:test";
import { createLayoutGuardPlugin } from "./layout-guard-plugin.ts";

/** Run the plugin's transform over one module; return its error or null. */
function check(code, id = "/app/src/App.tsx") {
	const plugin = createLayoutGuardPlugin();
	const context = {
		error: (message) => {
			throw new Error(typeof message === "string" ? message : message.message);
		},
	};
	try {
		plugin.transform.call(context, code, id);
	} catch (error) {
		return error.message;
	}
	return null;
}

test("rejects each removed component and names its replacement", () => {
	assert.match(check(`<Box gap="sm">x</Box>`), /<Box> was removed.*use Layout\.Row/s);
	assert.match(check(`<Stack>x</Stack>`), /<Stack> was removed.*use Layout\.Stack/s);
	assert.match(check(`<PageLayout/>`), /<PageLayout> was removed.*use Page/s);
	// Every spelling of an opening tag, not just the one with an attribute.
	assert.match(check(`<Box>x</Box>`), /<Box> was removed/);
	assert.match(check(`<Box\n  gap="sm"\n>x</Box>`), /<Box> was removed/);
});

test("accepts the current Layout family", () => {
	// The namespaced members are the replacements, so matching them would make
	// the guard reject the very thing it tells authors to use.
	assert.equal(check(`<Layout.Stack gap="sm"><Layout.Row>x</Layout.Row></Layout.Stack>`), null);
	assert.equal(check(`<Page><Page.Header/></Page>`), null);
	// A longer name that merely starts with a removed one is a different thing.
	assert.equal(check(`<BoxPlot/>`), null);
	assert.equal(check(`<StackedBar/>`), null);
});

test("only looks at the app's own JSX", () => {
	assert.equal(check(`<Box/>`, "/app/node_modules/dep/dist/index.jsx"), null);
	assert.equal(check(`<Box/>`, "/app/src/styles.css"), null);
	// A query suffix is stripped before the extension test.
	assert.match(check(`<Box/>`, "/app/src/App.tsx?used"), /<Box> was removed/);
});
