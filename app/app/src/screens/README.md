# Screens

One folder per app.json screen. `registry.ts` maps every route of `contracts/app/app.json` to
`src/screens/<shell>/<screen>/index.tsx` when that file exists, loaded lazily (its own chunk). Routes
without a folder render the placeholder (`src/shell/PlaceholderScreen.tsx`). Nothing else needs editing
to ship a screen: no route table, no import in `App.tsx`.

## Folder

`<shell>` is `rep` or `management`; `<screen>` is the app.json key, not the route:

| route | folder |
|---|---|
| `/rep/today` | `rep/today/` |
| `/rep/new-shops` | `rep/new_shops/` |
| `/rep/ai-log` | `rep/ai_log/` |
| `/mgmt/dashboard` | `management/dashboard/` |
| `/mgmt/settings/gdpr` | `management/gdpr/` |

```
src/screens/rep/today/
  index.tsx      required: default export = the screen component
  i18n.ts        optional: default export = defineScreenMessages({ en, el })
  *.tsx, *.ts    anything else the screen needs (components, hooks, pure logic)
  *.test.ts      unit tests (vitest, node env; keep logic in .ts so it is testable)
```

A screen WP owns only its folder. Shared pieces go to `src/lib` / `src/shell` through their owners.
A folder that matches no route is reported as an orphan (console warning, failing registry test).

## Props

```tsx
import type { ScreenProps } from "../../../lib/screenRegistry";
export default function Today({ screen, client, openLiveSocket, navigate, lang }: ScreenProps) { ... }
```

| prop | what |
|---|---|
| `screen` | the app.json entry: `route`, `functions`, `events`, `offline`, `mobile`, `voiceWidget` |
| `client` | `client.forScreen(screen.functions)`. `await client.call("today-get", {})` is typed by `@merc/contracts`, validates request and response, unwraps `{result, logs}`, and throws `MercApiError` (`code`, `status`, `details`). A slug not in the screen's app.json list throws `forbidden` (REQ-APP-001). In mock mode (top-bar toggle) the same call is answered by the contract mocks. |
| `openLiveSocket` | opener for `fn:merc-live` on this shell; `undefined` in mock mode |
| `navigate(route)` | go to another app.json route (the role check is applied) |
| `lang` | `"el"` (default) or `"en"` |

The screen is rendered inside an `AppBoundary` (error card with retry + Suspense), keyed by route, so a
crash or a pending `lazy` never takes down the shell.

## Live events

Listen only to the screen's app.json `events`; poll the same data while the socket is down (REQ-CORE-011):

```tsx
import { useLive } from "../../../lib/useLive";
const mode = useLive({ types: screen.events, openSocket: openLiveSocket, poll: refetch, onEvent: (e) => { if (e.type === "briefing.ready") refetch(); } });
// mode: "connecting" | "socket" | "polling"; events are validated against contracts/events before onEvent.
```

## Strings (REQ-APP-005)

Greek is the default, English the toggle. No hard-coded labels. Put the screen's strings in its folder:

```ts
// src/screens/rep/today/i18n.ts
import { defineScreenMessages } from "../../../lib/i18n";
export default defineScreenMessages({
  en: { empty: "No visits today", visits: "{n} visits" },
  el: { empty: "Καμία επίσκεψη σήμερα", visits: "{n} επισκέψεις" },
});
```

```tsx
import messages from "./i18n";
import { useScreenI18n } from "../../../lib/i18n";
const { t } = useScreenI18n(messages);
t("visits", { n: 3 });   // screen keys are typed; app-wide keys such as "common.loading" also work
```

`el` must have exactly the `en` keys (type-checked). The registry loads every `i18n.ts` eagerly and
registers it; the registry test fails on a missing or empty translation. The screen's title in the
navigation stays in `src/lib/i18n.ts` (`screen.<shell>.<key>`).

## Checklist for a screen WP

- `index.tsx` default-exports a component taking `ScreenProps`; calls only `screen.functions` via `client`.
- Strings in `i18n.ts`, both languages; layout works at phone width for rep screens (`screen.mobile`).
- Offline screens (`screen.offline`) cache their last data and queue writes.
- `pnpm test` and `pnpm build` pass in `app/app`.
