/**
 * Test-only stand-ins for @wonderful/ui-base, used by the approvals and team component tests.
 * ui-base cannot load in the vitest node env (it imports react-router), so tests do
 * `vi.mock("@wonderful/ui-base", () => import("./testkit/uiStub"))` and render to static markup.
 * Each component renders `<ui-name data-prop=...>` with its text/node props and children inline, so tests can
 * assert on visible text and on which actions exist.
 */
import { createElement, isValidElement, type ReactNode } from "react";

type AnyProps = Record<string, unknown> & { children?: ReactNode };
const NODE_PROPS = ["title", "description", "actions", "footer", "prefix", "suffix", "icon", "avatar", "label", "hint", "text"];

function listKids(key: string, list: unknown[]): ReactNode[] {
  return list.map((item, i) => {
    if (isValidElement(item)) return item;
    const o = (item ?? {}) as Record<string, unknown>;
    return createElement(`ui-${key}-item`, { key: i }, (o.label ?? null) as ReactNode);
  });
}

function stub(name: string) {
  const tag = `ui-${name.toLowerCase().replace(/\./g, "-")}`;
  const C = (props: AnyProps) => {
    const attrs: Record<string, unknown> = {};
    const kids: ReactNode[] = [];
    for (const [k, v] of Object.entries(props)) {
      if (k === "children" || typeof v === "function") continue;
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") attrs[k.startsWith("aria-") ? k : `data-${k.toLowerCase()}`] = String(v);
      if (Array.isArray(v)) kids.push(createElement(`ui-${k.toLowerCase()}`, { key: k }, ...listKids(k.toLowerCase(), v)));
      else if (NODE_PROPS.includes(k) && v !== null && v !== undefined && typeof v !== "boolean") kids.push(createElement("ui-slot", { key: k, "data-slot": k }, v as ReactNode));
    }
    if (typeof props.onClick === "function") attrs["data-clickable"] = "true";
    return createElement(tag, attrs, ...kids, props.children);
  };
  C.displayName = name;
  return C;
}

const parts = <P extends string>(name: string, ps: readonly P[]) =>
  Object.assign(stub(name), Object.fromEntries(ps.map((p) => [p, stub(`${name}.${p}`)])) as Record<P, ReturnType<typeof stub>>);

export const Card = parts("Card", ["Header", "Content", "Footer", "Meta", "List", "Stat"] as const);
export const Page = parts("Page", ["Header", "Section", "Toolbar"] as const);
export const Layout = parts("Layout", ["Stack", "Row", "Grid", "Center"] as const);
export const Skeleton = parts("Skeleton", ["Text", "Circle"] as const);
export const ToggleGroup = parts("ToggleGroup", ["Item"] as const);
export const Text = parts("Text", ["Inline", "Paragraph", "Heading"] as const);
export const Avatar = stub("Avatar");
export const AvatarFallback = stub("AvatarFallback");
export const Badge = stub("Badge");
export const Button = stub("Button");
export const EmptyState = stub("EmptyState");
export const InputNumber = stub("InputNumber");
export const InputText = stub("InputText");
export const Notice = stub("Notice");
export const Select = stub("Select");
