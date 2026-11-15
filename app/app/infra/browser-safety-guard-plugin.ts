import { parseAst, type Plugin } from "vite";

// Node-only constructs that must never reach a browser ESM bundle. Each is a
// load-time crash — `process is not defined`, `require is not defined` — that
// shows up as a blank "Failed to load app", so we catch them at build time
// instead of shipping one. These come from bundled dependencies (ui-base and
// its tree), not the app's own source, which is why the check is on the emitted
// bundle rather than the source (that is the layout guard's job).
//
// The check reads the bundle's SYNTAX, not its text. Scanning the text flagged
// any string that happened to contain one of these tokens, and the app's own
// copy is full of them: `/\bprocess\./` matches the prose "Finish the
// onboarding process. Then review it.", and a code sample or a docs page in a
// generated app matches `require(`. Each of those aborted a production build
// over a string literal that never executes. An identifier in the parsed tree
// is a real reference, so the guard now fires on the thing it is named for.
const FORBIDDEN_HINTS = {
	require:
		"a CommonJS `require(` call — a dependency was bundled as CJS. Externalize it in vite.config.ts, or use its ESM build.",
	process:
		"a Node `process.*` access — the browser has no `process`. `process.env.*` is folded by the production `define` in vite.config.ts; a stray reference means a dependency reads a different `process` field the define does not cover.",
	moduleExports:
		"a CommonJS `module.exports` — a dependency was bundled as CJS. Externalize it, or use its ESM build.",
	nodePath:
		"a Node path global (`__dirname` / `__filename`), which the browser does not have.",
} as const;

/** An ESTree node, walked structurally so no parser-specific types are needed. */
interface Node {
	type: string;
	[key: string]: unknown;
}

const isNode = (value: unknown): value is Node =>
	typeof value === "object" &&
	value !== null &&
	typeof (value as Node).type === "string";

const isIdentifier = (value: unknown, name: string): boolean =>
	isNode(value) && value.type === "Identifier" && value.name === name;

/**
 * Child keys that hold a NAME rather than a reference, so an identifier there
 * is never a read of a global: `a.process` and `{ process: 1 }` are an ordinary
 * property called "process", not the Node global.
 */
function skippedKey(node: Node, key: string): boolean {
	if (node.type === "MemberExpression") {
		return key === "property" && node.computed !== true;
	}
	if (node.type === "Property" || node.type === "PropertyDefinition") {
		return key === "key" && node.computed !== true;
	}
	// `import { __dirname as x }` / `export { x as process }` name module
	// exports, not globals, and a label is its own namespace.
	return (
		node.type.endsWith("Specifier") ||
		((node.type === "LabeledStatement" ||
			node.type === "BreakStatement" ||
			node.type === "ContinueStatement") &&
			key === "label")
	);
}

/** The hint for a node that is a real Node-only reference, else null. */
function nodeIssue(node: Node): string | null {
	if (node.type === "CallExpression" && isIdentifier(node.callee, "require")) {
		return FORBIDDEN_HINTS.require;
	}
	if (node.type === "MemberExpression") {
		// The bundler's stand-in for a CJS `require` of an external module calls
		// `require.apply(...)` and throws in the browser, so a member read counts.
		if (isIdentifier(node.object, "require")) {
			return FORBIDDEN_HINTS.require;
		}
		if (isIdentifier(node.object, "process")) {
			return FORBIDDEN_HINTS.process;
		}
		if (
			isIdentifier(node.object, "module") &&
			node.computed !== true &&
			isIdentifier(node.property, "exports")
		) {
			return FORBIDDEN_HINTS.moduleExports;
		}
	}
	if (
		node.type === "Identifier" &&
		(node.name === "__dirname" || node.name === "__filename")
	) {
		return FORBIDDEN_HINTS.nodePath;
	}
	return null;
}

/** First Node-only reference in the tree, or null when the chunk is clean. */
function findForbiddenReference(root: Node): string | null {
	const stack: Node[] = [root];
	while (stack.length > 0) {
		const node = stack.pop() as Node;
		const issue = nodeIssue(node);
		if (issue) {
			return issue;
		}
		for (const [key, value] of Object.entries(node)) {
			if (key === "type" || skippedKey(node, key)) {
				continue;
			}
			if (Array.isArray(value)) {
				for (const item of value) {
					if (isNode(item)) {
						stack.push(item);
					}
				}
			} else if (isNode(value)) {
				stack.push(value);
			}
		}
	}
	return null;
}

/**
 * Fails the production build when the emitted app bundle references a Node-only
 * global or CommonJS construct that would crash the app on load in the browser.
 * Runs in the output stage so it sees the fully-bundled code, dependencies and
 * all.
 *
 * A bundle that ships its own `process` shim is still reported, as it was under
 * the text scan: the reference is real, and whether the shim covers the field
 * being read is not something this guard can tell.
 */
export function createBrowserSafetyGuardPlugin(): Plugin {
	return {
		name: "wonderful-browser-safety-guard",
		generateBundle(_options, bundle) {
			for (const [fileName, output] of Object.entries(bundle)) {
				if (output.type !== "chunk" || !/\.[cm]?js$/.test(fileName)) {
					continue;
				}
				let ast: Node;
				try {
					// Vite's own parser, not `this.parse`: the plugin context's parse
					// hook is a bundler detail that moved between Rollup and Rolldown,
					// and `vite` is a dependency this plugin already has. The bundler
					// produced this chunk with the same parser, so a chunk it cannot
					// read back is a broken build rather than a clean one — say so
					// instead of passing the app through unchecked.
					ast = parseAst(output.code) as unknown as Node;
				} catch (error) {
					this.error(
						`${fileName} could not be parsed for the browser-safety check: ${
							error instanceof Error ? error.message : String(error)
						}`,
					);
					continue;
				}
				const hint = findForbiddenReference(ast);
				if (hint) {
					this.error(
						`${fileName} contains ${hint} It would fail in the browser ` +
							`with a "not defined" error on load — fix it before deploying.`,
					);
				}
			}
		},
	};
}
