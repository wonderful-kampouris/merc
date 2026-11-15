import type { Plugin } from "vite";

// Components removed in @wonderful/ui-base 4.0.0. An app that still renders one
// gets `undefined` for the element, which throws "Element type is invalid" on
// first paint — a blank screen with no clue. Fail the build with the migration
// instead, so the mistake is caught before deploy rather than at load.
// Each pattern is an opening JSX tag for the removed component and nothing else:
// `<Box `, `<Box>`, `<Box/>`. Spelling them out as literals (rather than
// building `new RegExp("<" + tag + ...)`) keeps them compiled once for the whole
// build instead of once per tag per file, and keeps a dynamic RegExp — which a
// reader, and a SAST scanner, has to prove is not attacker-shaped — out of the
// build entirely. `<Layout.Stack>` never matches: `.` is not in the character
// the pattern requires next.
const REMOVED_TAGS: readonly {
	readonly pattern: RegExp;
	readonly tag: string;
	readonly replacement: string;
}[] = [
	{
		pattern: /<Box(?:\s|\/?>)/,
		tag: "Box",
		replacement: "Layout.Row (a column is Layout.Stack)",
	},
	{ pattern: /<Stack(?:\s|\/?>)/, tag: "Stack", replacement: "Layout.Stack" },
	{ pattern: /<PageLayout(?:\s|\/?>)/, tag: "PageLayout", replacement: "Page" },
];

/**
 * Rejects a production app bundle that renders a ui-base component removed in
 * 4.0.0. Runs `enforce: "pre"` so it sees the author's TSX before any lowering.
 * It matches an opening JSX tag (`<Box `, `<Stack>`, `<PageLayout/>`) and never
 * `<Layout.Stack>`, so the current Layout family is unaffected.
 */
export function createLayoutGuardPlugin(): Plugin {
	return {
		name: "wonderful-layout-guard",
		enforce: "pre",
		transform(code, id) {
			const [file] = id.split("?");
			if (!/\.[jt]sx$/.test(file) || file.includes("/node_modules/")) {
				return null;
			}
			for (const { pattern, tag, replacement } of REMOVED_TAGS) {
				if (pattern.test(code)) {
					this.error(
						`<${tag}> was removed in @wonderful/ui-base 4 — use ${replacement}. ` +
							`See the "Layout — Read This First" section of AGENTS.md.`,
					);
				}
			}
			return null;
		},
	};
}
