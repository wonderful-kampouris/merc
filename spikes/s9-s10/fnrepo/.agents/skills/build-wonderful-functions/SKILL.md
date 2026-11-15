---
name: build-wonderful-functions
description: Build, test, review, and publish git-backed Wonderful Functions from a function repository.
---

# Build Wonderful Functions

Treat this checkout as the source of truth. Use native Git for branches, commits, pulls, and pushes, and `wful` for Wonderful-aware CI and repository operations.

Read [references/actions.md](references/actions.md) before creating, inspecting, or rerunning CI workflows.
Read [references/codeowners.md](references/codeowners.md) before creating or changing CODEOWNERS, or when a pull request requires an owner review.

Before adding a direct LLM call, create a Model Profile in Wonderful under
**Model Profiles → Profiles → Create profile**. Use its tenant profile UUID, or
an intentionally selected built-in static profile key, with
`ModelProfiles.ChatModel`. Never invent a profile ID. Model-specific APIs remain
available for existing functions, but they will be deprecated; migrate them to
`ModelProfiles.ChatModel` when changing their LLM integration.

Keep authored function source and configuration in their existing repository paths. Do not edit generated bundles or dependency caches. Run the repository's existing tests and type checks before pushing. After pushing, run `wful actions checks --watch --exit-status`; inspect failures with `wful actions list` and `wful actions view <run-id>`.

Never discard uncommitted work, rewrite history, merge, or publish unless the user explicitly requested it.
