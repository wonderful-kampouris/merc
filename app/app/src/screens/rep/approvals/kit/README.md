# rep screen kit (WP-APP-04)

Small helpers shared by the five WP-APP-04 rep screens (approvals, alerts, new_shops, week, ai_log).
It lives inside `rep/approvals/` because a screen WP may only write in its own folders; it is a
candidate to move to `src/lib` through that folder's owner.

| file | what |
|---|---|
| `useResource.ts` | load + silent reload with a loading / error / ready state; stale responses are ignored |
| `overrides.ts` | keep the result of a write over the list until the server's copy changes (stateless mocks, polling) |
| `useOverrides.ts` | React wrapper around `overrides.ts` |
| `errorKey.ts` | `MercApiError.code` -> i18n key |
| `format.ts` | dates in el-GR / en-GB, Europe/Athens; date-only arithmetic |
| `kitMessages.ts` | the kit's own strings (errors, retry) in el + en |
| `LoadingState.tsx`, `ErrorState.tsx`, `Feedback.tsx` | the shared loading / error / action-result views |
| `uiStub.ts`, `renderForTest.ts` | test-only: ui-base stand-ins for SSR component tests in the node env |
