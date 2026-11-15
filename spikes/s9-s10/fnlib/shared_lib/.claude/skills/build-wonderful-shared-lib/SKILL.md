---
name: build-wonderful-shared-lib
description: Build, edit, validate, and review a Wonderful Agent Studio shared library from its Git repository. Use when creating or changing reusable tools, utilities, diacritics, knowledge-base pointers, package configuration, or the shared library revision used by agents.
---

# Build a Wonderful Shared Library

The shared library is a standalone Git repository. Use `wful` for Wonderful-aware operations and native Git for branches, commits, pulls, and pushes.

## wful availability

`wful` is the Wonderful CLI.

- If an attempted `wful` command indicates that the executable is missing or unavailable, stop and ask the user to install it using the instructions from their Wonderful environment. Do not invent an environment URL, download an unofficial binary, or ask the user to paste credentials into chat.
- If the attempted command reports an authentication or workspace problem, ask the user to complete `wful login` or select the intended profile or workspace. Never expose or persist credentials yourself.
- This repository already contains the `build-wonderful-shared-lib` skill under `.agents/skills` and `.claude/skills`; no machine-level installation is required for this skill. `wful repo sync-skills` refreshes these committed copies.
- The optional general `wful` skill teaches Claude Code and Codex about platform-wide CLI workflows. With the user's approval, install or refresh it with `wful setup skill`; use `--claude` or `--codex` to target one coding agent explicitly.

## Workflow

1. Run `git status --short`, inspect the current branch, and preserve existing work.
2. Read [references/shared-library.md](references/shared-library.md) before changing the repository layout or publishing a library revision.
3. Read [references/tool-authoring.md](references/tool-authoring.md) before creating or editing a reusable tool.
4. Read [references/actions.md](references/actions.md) before creating, inspecting, or rerunning Wonderful Actions CI.
5. Read [references/codeowners.md](references/codeowners.md) before creating or changing CODEOWNERS, or when a pull request requires an owner review.
6. For a new tool, run `wful scaffold tool <tool_slug>`, then replace the starter implementation.
7. Edit source files only. Do not create or commit `dist/` bundles.
8. Run `wful validate` and available package tests or type checks, then inspect the final diff.
9. Commit and push the shared-library branch. The server builds and validates tools during push.
10. Use `wful pr create --lib` when the change needs review, then `wful pr checks <number> --lib --watch --exit-status` when CI is configured.

After the library revision is merged, update each consuming agent's `shared_lib` gitlink in a separate agent commit.

## Guardrails

- Put tools under `tools/<tool>/index.ts`. Never commit an untouched scaffold starter; implement its parameters and handler first.
- Keep `tools/`, `utils/`, `diacritics/`, and `kbs/` present even when empty.
- Never edit a consuming agent repository from the shared-library checkout implicitly.
- Never discard uncommitted work, rewrite history, merge, or publish unless the user explicitly requested it.
- Run `wful repo sync-skills --check` to check whether this Wonderful-managed skill is current. Use `wful repo sync-skills` to update it explicitly.
