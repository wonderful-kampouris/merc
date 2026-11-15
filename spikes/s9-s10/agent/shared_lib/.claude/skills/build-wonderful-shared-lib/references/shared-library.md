# Shared Library Reference

Read this reference when changing reusable code or publishing a shared-library revision.

## Repository layout

```text
package.json
.npmrc
tools/<tool>/index.ts
utils/
diacritics/
kbs/
```

The repository intentionally starts with empty authored directories. Create a new tool with `wful scaffold tool <tool_slug>`, then replace the starter parameters and handler with the requested implementation. Never commit an untouched starter. Generated bundles and dependency caches are ignored and must not be committed.

## Safe workflow

1. Confirm that the requested behavior should be shared across agents. Agent-specific behavior belongs in the consuming agent's `tools/` directory.
2. Search `tools/` and `utils/` before adding a duplicate.
3. Make the source change on a named branch.
4. Run `wful scaffold tool <tool_slug>` for a new tool, then implement it. Edit existing tools in place.
5. Run `wful validate`. If dependencies are installed, also run the package's existing tests and type checks. Do not introduce a new package manager or lockfile just to validate one change.
6. Commit and push with native Git. The server compiles tools and rejects an invalid push.
7. Create a review request with `wful pr create --lib`.
8. After merge, update consuming agents to pin the new shared-library commit.

Use `wful pr view <number> --lib --json` to inspect review state. Merge only when explicitly requested and after required checks pass.

## Knowledge-base pointers and diacritics

Keep knowledge-base pointers under `kbs/<slug>/kb.json` and pronunciation entries under `diacritics/<slug>.json`. These are platform contracts, not arbitrary storage folders. Match an existing valid entry and rely on the server-side shared-library validator for the current shape.
