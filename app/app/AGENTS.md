# AGENTS.md for Template Forks

This file is for developers (and coding assistants) working in a fork of this template.
Use it as the implementation contract for a Wonderful App bundle.

## Layout — Read This First

Everything comes from **`@wonderful/ui-base`**. Compose it; don't write custom
CSS, and don't hand-write a flex `div`.

**The page frame is `Page`.** `Page.Header` takes `title` / `description` /
`actions`; every direct child of `Page` is a `Page.Section` (never a bare
`<div>`), and `Page` owns the width and the insets.

**Inside a section, use the `Layout` family** — and say what you want:

| You want… | Reach for |
|---|---|
| things one under another | `Layout.Stack` |
| things on one line | `Layout.Row` (`wrap` for tags/chips, `split` for title-left/actions-right) |
| N equal tiles | `Layout.Grid idealColumns={n}` — the desktop count; it derives the rest |
| something centered in a region | `Layout.Center` |
| a bordered, padded, tinted block around any of the above | `Card` (+ `Card.Header` / `Card.Content` / `Card.Footer`) |

**One `gap` scale, in words, never numbers:** `none` · `xs` (4) · `sm` (8) ·
`md` (12, the default) · `lg` (16) · `xl` (24). Wrap a region in
`<Layout gap="…">` to set one gap for everything beneath it.

**A layout has no surface.** If you are about to give a `Layout.*` padding, a
background, a border or a radius, you wanted a `Card`. `className` on a layout
is for its surrounding size only (`w-full`, `flex-1`, `shrink-0`, `min-h-0`).

**A raised surface is `<Elevation>`, never a hand-written `shadow-*` and never a
shadow prop on a component.** Wrap the surface with `asChild` so the shadow
traces its border radius:

```tsx
<Elevation level="sm" asChild>
  <Card>…</Card>
</Elevation>
```

`level` is `none | sm | md | lg | xl` (default `md`); add `clickable` (or
`hoverable`) when the surface is itself the control. Anything subtler than `sm`
is a border, not elevation.

**Card body variants — pick the region by content.** The body of a card is not always `Card.Content`. Pick the member that fits the
content instead of rebuilding it out of `Layout` + `Text`:

- **`Card.Content`** — general content (prose, form fields, a chart). Arrange what's inside with `Layout.*`.
- **`Card.List`** — a list of rows with a divider between each; its rows are `Card.Meta` (or `Card.List.CollapsibleItem`). Use it instead of `Card.Content` for list content — don't hand-roll rows and dividers in a `Layout.Stack`.
- **`Card.Meta`** — one list-style row: a leading `avatar`, a `title` + `description` column, and trailing `actions`. Use as `Card.List` rows, or as a compact card's whole body.
- **`Card.Stat`** (+ `Card.Stat.Delta`) — a KPI / metric widget: `prefix` / `value` / `suffix`, with a `Card.Stat.Delta` (`value`, `direction="up" | "down"`, `label`) for the trend. Put the metric's label in `Card.Header`.

A metric widget:

```tsx
<Card>
  <Card.Header title="Revenue" />
  <Card.Stat prefix="$" value="128.4k">
    <Card.Stat.Delta value="12.5%" direction="up" label="vs last week" />
  </Card.Stat>
</Card>
```

A list card (rows are `Card.Meta`, dividers come from `Card.List`):

```tsx
<Card>
  <Card.Header title="Team" />
  <Card.List>
    <Card.Meta avatar={<Icon icon={UserIcon} />} title="Ada Lovelace" description="Owner" actions={<Button variant="tertiary" size="small" …/>} />
    <Card.Meta avatar={<Icon icon={UserIcon} />} title="Alan Turing" description="Admin" />
  </Card.List>
</Card>
```

**Structure is the sub-components; `Layout.*` only arranges inside them.** `AppLayout` + `AppShell`, `Page`, and `Card` each own their structure through
their OWN members. The `Layout` family arranges the content that goes **inside**
a slot — it does **not** replace the slot. Swapping a sub-component for a
`Layout` throws away the spacing, dividers, sticky behaviour and typography the
slot gives you for free, and is the single biggest cause of a generated app
looking off. **Reach for the slot first; use `Layout.*` only for what sits
within it.**

| For | Use the sub-component — not a `Layout.*` |
|---|---|
| a title row with actions on the right | `Page.Header` (`title`/`description`/`actions`) or `Card.Header` (`title`/`actions`) |
| a page's toolbar of filters/search | `Page.Toolbar` |
| each block of a page | `Page.Section` (one per block — never a bare `Layout.Stack` straight under `Page`) |
| a card's title / content / actions | `Card.Header` / `Card.Content` / `Card.Footer` |
| a KPI figure | `Card.Stat` (+ `Card.Stat.Delta`) |
| the app rail + topbar + body | `AppLayout` + `AppShell` (+ `AppShell.Topbar` / `.Actions`) — there is no `AppLayout.Shell` |

**Wrong** — `Layout` standing in for the card's slots (no header rhythm, no body inset):

```tsx
<Card>
  <Layout.Stack gap="sm">
    <Layout.Row split><Text variant="heading-3">Positions</Text><Button>Add</Button></Layout.Row>
    <Text>…</Text>
  </Layout.Stack>
</Card>
```

**Right** — the slots own the structure; `Layout` only arranges what's inside the body:

```tsx
<Card>
  <Card.Header title="Positions" actions={<Button>Add</Button>} />
  <Card.Content>
    <Layout.Stack gap="md"><Text>…</Text></Layout.Stack>
  </Card.Content>
</Card>
```

The same rule holds up the tree: `Page.Header` + `Page.Section`, never a
`Layout.Stack` directly under `Page`; `AppShell.Topbar`, never a hand-built bar.

**Composition happens at the call site.** `Card` and friends take `as`, so a
linked card is `<Card as="a" href={…}>` — don't build a `LinkCard` wrapper that
freezes one structure.

> `Box` and the old flat `Stack` are **gone**. If you are reading an older app
> that uses them, it is pinned to `@wonderful/ui-base@0.100.0`; this template is
> on 4.x, where `<Box direction="column">` is `<Layout.Stack>`,
> `<Box direction="row">` is `<Layout.Row>`, `<Box direction="row" justify="between">`
> is `<Layout.Row split>`, and numeric `gap={n}` is `gap="sm|md|lg|…"`.

## Loading and failure — wrap regions in `AppBoundary`

A render error in one part of the app must not blank the whole screen, and a
region that fetches data needs a loading state. The template ships
`src/AppBoundary.tsx` for both: it pairs a React error boundary with a
`<Suspense>` fallback.

**Wrap each independent region in its own `AppBoundary`** — one per thing that
loads or can fail on its own — so a failure stays local and the rest of the page
keeps rendering:

```tsx
import AppBoundary from "./AppBoundary";

<Page.Section>
  <AppBoundary>
    <PortfolioTable />        {/* suspends while its data loads, isolated if it throws */}
  </AppBoundary>
</Page.Section>
```

Do not delete `src/AppBoundary.tsx` or `src/AppErrorBoundary.tsx`; the starter
`App` renders inside them and the deploy host renders your default export as-is.

## The UI library is compiled into your bundle

`@wonderful/ui-base` is a **dependency you build**, not something the platform
hands you at render time. `pnpm build` compiles it into `dist/app.js`,
tree-shaken to the components you actually import — a starter app that uses
`Page`, `Layout`, `Card` and `Text` costs about 100 KB, and heavy things
(`recharts`, `three`) never enter the bundle unless something imports them.

Two consequences worth internalizing:

- **Your app is pinned to the version in `package.json`.** It keeps rendering
  exactly as built, forever, no matter what the platform upgrades to. Nothing
  breaks under you.
- **You don't get new components for free.** A `Layout` member or a `Card` slot
  added after your pin isn't available until you upgrade.

### Check for a newer version before you start

The sandbox has **no registry access for the `@wonderful` scope** — its npmrc
only points at the public npm registry — so `npm view @wonderful/ui-base` will
not work. Compare against the template instead, which is baked into the image
at the current version:

```bash
# yours
node -p "require('./package.json').dependencies['@wonderful/ui-base']"
# what the platform currently ships
node -p "require('/workspace/skills/wonderful-apps/assets/template-ready/package.json').dependencies['@wonderful/ui-base']"
```

If the template's is newer, **say so and offer to migrate** — don't upgrade
silently in the middle of another change, and don't leave an app stranded on an
old major without mentioning it.

### Migrating

```bash
pnpm add @wonderful/ui-base@<version>   # then:
pnpm build                              # tsc runs first — type errors are your migration list
```

**A major version removes things.** `4.0.0` deleted `Box` and the flat `Stack`
in favour of the `Layout` family, and reshaped `Card`: if you are upgrading an
app written against `0.x`, expect `<Box direction="column">` → `<Layout.Stack>`,
`<Box direction="row">` → `<Layout.Row>`, `<Box direction="row" justify="between">`
→ `<Layout.Row split>`, numeric `gap={n}` → `gap="sm|md|lg"`, `PageLayout` →
`Page`, and `<Card padding={n}>` → `<Card>` with a `Card.Content` (the card owns
its own inset now). The compiler will find every call site; work through
`pnpm build` until it is clean, then check the app in the preview before
packaging.

`5.0.0` renamed for clarity: `Card.Body` → `Card.Content` (the flat export is
`CardContent`; `CardBody` is gone, and `Card.Body` survives only as a
deprecated alias), `Card.List.Collapsible` → `Card.List.CollapsibleItem`, and
`Page.Header`'s `subtitle` → `description`. `PageHeader` is now the same
component as `Page.Header`.

`6.0.0` moved `Button` to the V2 design-system API. `variant`: `solid` →
`primary`, `outlined` / `dashed` → `secondary`, `text` → `tertiary` (`link`
stays). `color`: `primary` / `secondary` → `default` (drop the prop), and
`danger` / `warning` mark destructive / risky actions in any variant. `size`:
`xs` → `inline`. A bare `<Button>` is `secondary` + `default`.

## JavaScript / TypeScript Conventions

Non-negotiable, and identical to the platform monorepo's `js-standards`:

- **Write functionally.** Every logical component is obtained by calling a
  function — never export a bare instance or a class for the caller to `new`.
- **Function names start with a verb**, and most are `get*` or `create*`:
  `create*` always constructs something new, `get*` returns an existing or
  cached thing. **Never `build*`** — use `create*`. A cached `create*` is
  wrapped by a `get*`; never cache inside a `create*`.
- **Camel-case identifiers**: `lowerCamelCase` variables and functions,
  `UpperCamelCase` classes and types, `SCREAMING_SNAKE_CASE` module constants.
  Never `snake_case`.
- **One component per file, named after it, `export default`.** The file may
  also export minor related types/helpers as named exports. A function's file is
  lowercase (`createTicket.ts`); a **class's** file starts with a capital
  (`TicketStore.ts`), like a React component file.
- **A big file becomes a folder of the same name**, exposed through an
  `index.ts` that `export default`s the same component, so import sites don't
  change. The internals become sibling files inside that folder and stay
  private to it; if one turns out to be shared, it moves out rather than being
  exposed. This nests.
- **Barrels for libraries** and library-like folders (`utils/`, `common/`,
  `lib/`) — never a barrel on a top-level `src/` folder. Import through the
  descendant.
- **A class is allowed where memory warrants it** (large structures, prototype
  sharing) but is never the exported surface: expose it through a `create*`
  factory — `createSomething/index.ts` + `Something.ts`, with
  `createSomething = (...args) => new Something(...args)`.

React components keep their framework naming: a component is a noun
(`OpenTicketsWidget`), a hook is `use*`. The verb rule governs plain functions.

- **Scripts are TypeScript**, run as natively as possible: bare `node
  script.ts` first (no loader, no dependency), `tsx` only when the script needs
  path aliases or non-erasable syntax. Don't add new `.mjs`/`.js` scripts.
  Native running requires erasable-only TS — no `enum`, `namespace`,
  constructor parameter properties or `import =`; use `import type` for
  type-only imports and a `const` object plus a union type instead of an enum.

## Exposing a Widget

To let another app embed part of this app, export that part by
name from `src/index.ts` and declare it in `wonderful.json`:

```json
"widgets": [
  { "key": "open_tickets", "name": "Open tickets", "export": "OpenTicketsWidget", "size": "ms" }
]
```

The `default` export stays the app itself and can never be a widget. `size` is
a canvas-cell preset — `"s"` (1x1), `"mw"` (2x1), `"ms"` (2x2, the default) or
`"l"` (3x2) — or `{ "width": 640, "height": 400 }`; a widget
component receives an optional `params` object from its host. Embed another
app's widget with `<AppWidget app="<slug>" widget="<key>" />` from
`@wonderful/app-sdk` — it renders nothing in the local runner, which serves
only this app.

Build the widget itself from the `wonderful-app-widgets` skill: it sets the
sizes, states and chart rules, and ships a widget kit to copy into
`src/widgets/kit/`. The host draws the card, so the widget's root never paints
its own background, border or shadow.

## What to Keep Intact

- Keep `src/index.ts` as a default export entry point for your app component.
- Keep the bundle contract: `pnpm build` outputs `dist/app.js` (and optional `dist/style.css`).
- Keep packaging contract: `pnpm package` must include build files plus `manifest.json`.
- Keep the source-in-bundle contract: `pnpm package` ships a snapshot of the
  app's source under `source/` inside the zip. The controller stores it inside
  `bundle.zip` for `controller-cli apps download --extract` round-trips, but
  never serves it to the deployed app. To rebuild a fresh source checkout from
  a deployed app: `controller-cli apps download --app <slug> --extract <dir>`.
  Set `BUNDLE_INCLUDE_SOURCE=false` only if you intentionally need a
  source-free bundle (rare; loses the ability to round-trip edits).

## First Steps After You Fork

1. Dependencies are already declared in `package.json`. Agent Builder prepares
   `node_modules`; outside Agent Builder, run this only when dependencies are
   missing (on your own computer, first set up the registry as described in
   "Local development outside a Wonderful sandbox" below):

```bash
pnpm install
```

Do not run `pnpm add @wonderful/app-sdk`: it is a host-provided runtime module,
not a published package. Keep `@wonderful/ui-base` at the version already pinned
in `package.json`; it must match the UI ABI provided by the Wonderful app host.

GenUI is optional and is not declared in the base template. Only when the app
imports `GenUISurface` (or another export from `@wonderful/genui-react`), add the
pinned package as a dev dependency:

```bash
pnpm add -D @wonderful/genui-react@0.2.0
```

This updates the opted-in app's `package.json` and lockfile so `tsc --noEmit`
can resolve the package's types. Keep `@wonderful/genui-react` in Vite's
`external` list: the Wonderful host supplies the runtime module, so it is not
included in the app bundle.

2. Build your app UI in `src/App.tsx` (or split into `src/components/*`).
3. Use runner mode when building features that call Wonderful APIs.

Agent Builder configures the authenticated `@wonderful` registry for its
environment. Do not add an absolute `@wonderful:registry` entry to the project
`.npmrc`; it can override the authenticated environment mapping.

### Local development outside a Wonderful sandbox

`@wonderful/*` packages come from the environment's private registry at `https://<api-host>/api/npm/`, not from npmjs. On a developer's own computer, an `ERR_PNPM_FETCH_404` or a 404 from `registry.npmjs.org` for a `@wonderful/*` package means the computer is not set up yet, not that the package is missing. Any signed-in user can fix it once, without a token from Wonderful or a platform admin, with the API host of the `wful` profile that cloned the app (`wful apps clone` prints the exact command; with `--json`, it returns the command as `registry_login_command`):

```bash
npm login --auth-type=web --scope=@wonderful --registry=https://<api-host>/api/npm/
```

Then run `pnpm install` in `app/`.

## Styling

**Structure and surfaces come from components, not CSS.** `Layout.*` for
arrangement, `Card` for a surface, `<Elevation>` for a raised one, and the
design tokens below for color — never a hand-written flex `div`, a `shadow-*`,
or a hardcoded hex. `src/style.css` is the escape hatch for whatever those can't
express, and it too uses the tokens.

- Keep `src/index.ts` export-only (no CSS imports).
- Import `src/style.css` from `src/App.tsx` (or your top-level app component).
- Write styles in `src/style.css` using standard CSS that references the design
  tokens below. The file is bundled into `dist/style.css` on build.
- For RTL, use logical properties (`padding-inline-start`, `margin-inline-end`),
  not `padding-left` / `margin-right`. Give SVG icons `fill="currentColor"` and
  set the color on the parent.

## Accessing Wonderful APIs from the App

Use `useWonderful()` from `@wonderful/app-sdk`. Do not put API keys or controller base URLs in browser code.

```tsx
import { useEffect, useRef, useState } from "react";
import { useWonderful } from "@wonderful/app-sdk";

type ApiEnvelope<T> = {
  data: T;
  status?: string;
};

type AgentSummary = {
  id: string;
  display_name: string;
};

export default function AgentsList() {
  const { api } = useWonderful();
  const apiRef = useRef(api);
  apiRef.current = api;
  const [agents, setAgents] = useState<AgentSummary[]>([]);

  useEffect(() => {
    const load = async () => {
      const response = await apiRef.current.get<ApiEnvelope<AgentSummary[]>>(
        "/api/v3/agents?page=1&limit=10",
      );
      setAgents(response.data);
    };
    void load();
  }, []);

  return (
    <div>
      <pre>{JSON.stringify(agents, null, 2)}</pre>
    </div>
  );
}
```

### API Path Rules

- `api.get("/something")` -> `/api/v1/something`
- `api.get("/api/v3/agents")` -> `/api/v3/agents` (keeps explicit `/api/*`)

Use explicit `/api/v3/agents` paths for agent integrations. These routes require Wonderful Agent provisioning. Creating an agent uses `POST /api/v3/agents` with `display_name` and the fields required for its mode.

## Importing UI from `@wonderful/ui-base`

Use root imports from `@wonderful/ui-base` (no deep imports).

**Look up the API in the package's own docs, not in `node_modules`.** From
version 6.1.0, `@wonderful/ui-base` ships its API reference, generated from the
library source for that exact version:

1. Read `node_modules/@wonderful/ui-base/docs/index.md` first (about 1.5k
   tokens). It states the rules and lists every component on one line.
2. For a whole screen, start from the closest one in `docs/recipes.md`.
3. Before you use a component, read `docs/components/<Name>.md` (under 1k
   tokens: rules, props with defaults, parts, an example).
4. Do not grep `node_modules/@wonderful/ui-base` or its `.d.ts` files to learn
   the API.

If `docs/index.md` is missing, the pinned version is older than 6.1.0; use the
`wonderful-apps` skill's component reference instead.

```tsx
import { Button, InputText, Layout, Text } from "@wonderful/ui-base";
import { useState } from "react";

export function CreateForm() {
  const [name, setName] = useState("");

  return (
    <Layout.Stack gap="lg">
      <Text variant="heading-3">Create item</Text>
      <InputText
        label="Name"
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <Button
        disabled={!name.trim()}
        onClick={() => {
          // submit action
        }}
      >
        Save
      </Button>
    </Layout.Stack>
  );
}
```

### UI Import Rules

- Prefer `@wonderful/ui-base` components over custom primitives.
- Import types as `import type { ... } from "@wonderful/ui-base"` when needed.
- Avoid deep imports like `@wonderful/ui-base/dist/...`.

## Icons

Icons are **Phosphor** — `@phosphor-icons/react`, already a dependency of this
template. There are no font icons. Import the `*Icon`-suffixed named export (the
bare names like `Pencil` are deprecated) and render it through ui-base's `Icon`
so it inherits size and `currentColor`:

```tsx
import { Icon } from "@wonderful/ui-base";
import { PencilIcon, TrashIcon } from "@phosphor-icons/react";

<Icon icon={PencilIcon} />
```

- **Named imports tree-shake** — only the icons you import are bundled (one icon
  is a few KB, not the whole set). Import named symbols from the
  `@phosphor-icons/react` barrel; never import its namespace (`import * as`).
- The whole icon set ships in the one package, so a new icon needs no install.
  To pin or bump: `pnpm add @phosphor-icons/react@^2.1.10`.
- A one-off brand mark with no Phosphor equivalent can still be a local SVG via
  SVGR (`import Logo from "./logo.svg?react"`), colored with `fill="currentColor"`
  and the color set on the parent.

## Tables — the actions column

In a `Table` action column, **prefer icon buttons with tooltips over text
buttons.** A row of "Edit" / "Resend" / "Delete" labels eats the width the data
needs and grows with every translation; a row of icons stays the same size in
every locale.

```tsx
import { Button, Icon, Layout, Tooltip } from "@wonderful/ui-base";
import { PencilIcon } from "@phosphor-icons/react";

{
  id: "actions",
  header: "Actions",
  enableSorting: false,
  size: 120,                        // fixed and narrow — it holds icons
  cell: ({ row }) => (
    <Layout.Row gap="sm">
      <Tooltip content="Edit">
        <Button
          variant="tertiary"
          size="small"
          prefix={<Icon icon={PencilIcon} />}
          aria-label="Edit"
          onClick={() => onEdit(row.original.id)}
        />
      </Tooltip>
      {/* …one Tooltip-wrapped icon button per action */}
    </Layout.Row>
  ),
}
```

- **An icon-only `Button` has no children** — the icon goes in `prefix`, with
  `variant="tertiary"` + `size="small"` so it does not crowd the row.
- **Always give it an `aria-label`.** A tooltip is a visual affordance, not an
  accessible name; without the label a screen reader announces only "button".
- **More than about three actions, or a destructive or rare one → collapse them
  into a `Dropdown`** instead of a longer row of icons.
- A single primary call to action — one "Install" or "Connect" column — still
  reads better as a **text button** with a word.

## Dialogs — `Modal` and `Modal.Footer`

A dialog is `Modal`. Its three regions each have one home, and none of them is
a hand-built `Layout`:

| Region | Where it goes |
|---|---|
| title, subtitle, leading icon | the `title` / `description` / `icon` **props** — there is no `Modal.Header` |
| the content | `children` |
| the action buttons | the `footer` prop, **always built from `<Modal.Footer>`** |

```tsx
import { Button, InputText, Layout, Modal } from "@wonderful/ui-base";

<Modal
  open={isOpen}
  onClose={close}
  title="Add position"
  description="Track a new holding."
  footer={
    <Modal.Footer>
      <Button variant="secondary" onClick={close}>Cancel</Button>
      <Button variant="primary" onClick={save} disabled={!symbol}>Add</Button>
    </Modal.Footer>
  }
>
  <Layout.Stack gap="md">
    <InputText label="Symbol" value={symbol} onChange={(e) => setSymbol(e.target.value)} />
  </Layout.Stack>
</Modal>
```

- **Buttons never go in `children`.** Actions placed at the bottom of the body
  scroll away with the content, have no divider, and sit at the body's inset
  rather than the footer's. They belong in `footer`.
- **`footer` is `<Modal.Footer>`, never a `Layout.Row` or bare buttons.**
  `Modal.Footer` gives the end-aligned row, the gap between buttons and the
  footer's inset for the modal's variant. Order the buttons cancel first and the
  primary action last.
- **A destructive action on the far side** goes inside the same
  `Modal.Footer`, as a `<Layout.Row split className="w-full">` with the
  destructive button in the first group and cancel/confirm in the second.
- **Title and subtitle are props, not body text.** Do not open the body with
  a `<Text variant="heading-3">`; that duplicates the header and leaves the
  dialog without an accessible name.
- **A yes/no question is `Modal.confirm({ title, content, onOk, isDanger })`**,
  not a hand-built modal.
- The `Modal` is a **sibling** of the `Page` / `Card` that opens it (return a
  fragment), never a child of one of their slots.

## Simulation results — use the platform's popup parts

To show a simulation (eval) run, render the `Simulation*` components from
`@wonderful/ui-base` inside a `Modal size="fullscreen"`: `SimulationResultViews`
with `SimulationCriteria`, `SimulationTranscript` and `SimulationScenario`, plus
`SimulationStats` and `SimulationProfileList` for the batch. They are the same
components Agent Studio uses, so the popup looks the same. Fetch the run with
`api.get` from the v2 eval endpoints (`/agents/{agentId}/eval/...`, the run)
and `/communications/{id}` (its transcript and recording), unwrap the `{ data }`
envelope, and map it onto their types. Scope each path to the app's workspace
yourself — `/api/workspace/${context.workspaceId}/v2/...`, or `/api/v2/...` in
General — because `api.get` passes `/api/...` paths through unchanged, so a
bare `/api/v2/...` always reads the General workspace.
The skill's `implementation-patterns.md` has the endpoints and a full example.
Do not open Agent Studio in a new tab instead.

## Empty states — `EmptyState`

A list or table with no rows renders `EmptyState` (`title`, `description`,
`icon`, `footer` for the call to action) inside the region it replaces. Pass the
icon **unsized** — `icon={<Icon icon={ChartLineUpIcon} />}`. The cover draws it
at its own fixed size; a `size` prop on the icon is ignored.

## Local Development Modes

- `pnpm dev`: static UI iteration.
- `pnpm runner`: preferred for SDK context + API integration testing.

Runner reads `WONDERFUL_API_KEY` server-side and proxies app API calls through `/proxy/*`.

### Required Local Runner Compatibility

Keep these behaviors when editing template infrastructure:

- Load `@wonderful/ui-base/style.css` in local entrypoints:
  - `dev/main.tsx`
  - `runner/main.tsx`
- Do not import `@wonderful/ui-base/style.css` from `src/index.ts` (bundle entry).
- Do not import `src/style.css` from `src/index.ts` (bundle entry).
- In `runner/server.mjs`, preserve proxy decoding safeguards:
  - remove `accept-encoding` before proxying upstream requests
  - remove `content-encoding` when forwarding upstream responses
- Keep `@wonderful/app-sdk` aliasing to `runner/sdk-shim.ts` for `dev` and `runner` modes in `vite.config.ts`.

## Uploading to Wonderful

App upload is currently manual in the Wonderful UI.

1. `pnpm build && pnpm package`
2. Open your app in Wonderful UI
3. Upload the zip from `dist/` in the **Versions** page
4. Activate the uploaded version

Do not rely on API-key upload flow for app bundle publishing.

## Custom Tables API

Use `api` from `useWonderful()` to read and write custom tables.

```ts
// Create a table
await api.post("custom-tables", {
  name: "my_table",
  description: "...",
  columns: [
    { name: "title",  type: "string", required: true },
    { name: "amount", type: "number", required: true },
  ],
});

// Insert a row
await api.post("custom-tables/my_table/rows", {
  data: { title: "Foo", amount: 1000 },
});

// Fetch rows — pages are 1-indexed
const res = await api.get<{
  data: Array<{ id: string; data: Record<string, unknown> }>;
  pagination: { total_rows: number; total_pages: number; page: number; limit: number };
}>("custom-tables/my_table/rows?page=1&limit=20");

// Update a row
await api.put(`custom-tables/my_table/rows/${id}`, { data: { amount: 2000 } });

// Delete a row
await api.del(`custom-tables/my_table/rows/${id}`);
```

**Error behaviour:** When a table does not exist, the API returns **500**, not 404. Do not rely on 404 detection.

## Preventing Infinite Fetch Loops with `useWonderful()`

The `api` object from `useWonderful()` is recreated on every render. Using it directly in `useCallback` or `useEffect` deps causes an infinite loop. Store it in a ref:

```ts
const { api } = useWonderful();
const apiRef = useRef(api);
apiRef.current = api;

const fetchData = useCallback(async () => {
  const res = await apiRef.current.get("...");
  // ...
}, []); // empty deps — stable reference via ref

useEffect(() => { fetchData(); }, [fetchData]);
```

## Platform Design Tokens

The Wonderful platform ships a design token system (from `@wonderful/theme`, delivered via `@wonderful/ui-base`). Always use these tokens instead of hardcoded hex values so your app stays visually consistent with the platform and picks up future theme changes. The host drives dark mode with the **`data-theme-mode="dark"` attribute** (its values inherit into your app), so tokens flip automatically — never key off a `.dark` class or hardcode per-mode colors.

### Semantic tokens (prefer these)

Use the semantic tokens by role; they map onto the primitives below and flip with the mode. Available as CSS vars (`var(--card)`) and, if your build includes the ui-base utilities, as classes (`bg-card`, `text-foreground`, `border-border`, `bg-danger`, …):

| Role | Tokens |
|---|---|
| Surfaces | `--background`, `--background-secondary`, `--elevated` |
| Text | `--foreground` |
| Cards | `--card`, `--card-foreground`, `--card-secondary` |
| Form fields | `--input`, `--input-foreground`, `--input-border` |
| Borders | `--border`, `--border-subtle`, `--border-strong`, `--card-border` |
| Intent | `--primary`, `--secondary`, `--success`, `--warning`, `--danger`, `--accent` — each with a `-foreground` |

The raw primitives below still exist and back the semantic tokens — prefer the semantic ones.

### Surfaces & Borders

| Token | Light value | Dark value | Use for |
|---|---|---|---|
| `--surface-00` | `#ffffff` | `#181818` | Card / panel background |
| `--neutral-00` | `#fafafa` | `#080808` | Secondary surface, input background |
| `--neutral-100` | `#f5f5f5` | `#1e1e1e` | Page background |
| `--neutral-200` | `#f1f1f1` | `#252525` | Subtle tint |
| `--neutral-300` | `#e5e5e5` | `#2e2e2e` | Border, divider |
| `--neutral-400` | `#dbdbdb` | `#383838` | Strong border |
| `--neutral-500` | `#dddddd` | `#484848` | Disabled border |

### Text

| Token | Light value | Dark value | Use for |
|---|---|---|---|
| `--foreground-100` | `#141414` | `#f5f5f5` | Primary text |
| `--neutral-800` | `#393939` | `#e0e0e0` | Strong secondary text |
| `--neutral-700` | `#777777` | `#b0b0b0` | Secondary / label text |
| `--neutral-600` | `#a9a9a9` | `#9e9e9e` | Placeholder / muted text |

### Semantic Colors (static — same in light and dark)

Each semantic color comes in three strengths:

| Name | Full (`-100`) | Tint bg (`-5`) | Border (`-30`) |
|---|---|---|---|
| Blue | `#2399fa` | `#2399fa0d` | `#2399fa4d` |
| Green | `#03a97e` | `#03a97e0d` | `#03a97e4d` |
| Amber | `#faad14` | `#faad140d` | `#faad144d` |
| Red | `#ff3f3f` | `#ff3f3f0d` | `#ff3f3f4d` |
| Purple | `#ba98ff` | `#ba98ff0d` | `#ba98ff4d` |
| Orange | `#ffa75a` | — | — |

CSS variables: `--color-blue-100`, `--color-blue-5`, `--color-blue-30` (same pattern for each color).

**Typical badge pattern:**
```css
.badge-success {
  color:      var(--color-green-100);
  background: var(--color-green-5);
  border:     1px solid var(--color-green-30);
}
```

**Chart colors** — use the `-100` values: blue `#2399fa`, green `#03a97e`, amber `#faad14`, red `#ff3f3f`, purple `#ba98ff`, orange `#ffa75a`.

### How to use tokens in your app

Declare an alias layer on your root element so tokens resolve inside the Shadow DOM, then reference the aliases throughout your CSS:

```css
.app-root {
  /* Surfaces, text, borders — prefer the SEMANTIC tokens: one name per role,
     and they flip with the mode on their own. */
  --app-bg:        var(--background,     #f5f5f5);
  --app-surface:   var(--card,           #ffffff);
  --app-surface-2: var(--card-secondary, #fafafa);
  --app-border:    var(--border,         #e5e5e5);
  --app-text:      var(--foreground,     #141414);

  /* Solid status fill — a semantic intent paired with its foreground. */
  --app-danger:    var(--danger,            #ff3f3f);
  --app-danger-fg: var(--danger-foreground, #ffffff);
  --app-success:   var(--success,           #03a97e);

  /* Subtle tinted badges and chart series — the `--color-*` primitives carry
     the -5 (tint) and -30 (border) steps the semantic intents don't expose in
     plain CSS. Reach for these ONLY for tints; use the semantic tokens above
     for everything else. */
  --app-green-lt:  var(--color-green-5,  #03a97e0d);
  --app-green-bd:  var(--color-green-30, #03a97e4d);
}
```

The hardcoded fallbacks ensure correct rendering in local `pnpm dev` / `pnpm runner` before the platform stylesheet loads. Always use a unique prefix (e.g. `--app-`, `--myapp-`) to avoid collisions with platform-level variables.

## Styling in Shadow DOM

Apps are embedded inside a Shadow DOM in the Wonderful UI. This affects CSS in two important ways:

### 1. Define CSS variables on your root element, not `:root`

CSS custom properties declared in `document.head` stylesheets do not reliably reach inside the shadow root. Re-declare all variables on the app's top-level element so they resolve for all descendants:

```css
.app-root {
  --myapp-bg: #F4F5F7;
  --myapp-text: #111827;
  --myapp-border: #E5E7EB;
  /* ... */
  background: var(--myapp-bg);
  color: var(--myapp-text);
  font-family: 'Inter', sans-serif;
  font-size: 14px;
}
```

### 2. Use a unique CSS variable prefix

The platform loads Tailwind v4 which defines common names like `--green`, `--blue`, `--red`, `--amber` as CSS variables. Using the same names will cause collisions. Always namespace your variables (e.g. `--myapp-green`, `--myapp-blue`).

### 3. Move `body` styles to your root element

`body {}` rules do not apply inside the shadow root. Any font, color, or background set on `body` must be moved to `.app-root` (or equivalent).

## Required Validation Before Handoff

Every implementation must run and pass:

```bash
pnpm install
pnpm build
pnpm build:runner
```

When handing work off to another agent, include:

- exact files changed
- short implementation summary
- results of the three required commands above
