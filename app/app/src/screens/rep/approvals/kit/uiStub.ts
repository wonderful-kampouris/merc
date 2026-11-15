/**
 * Test-only stand-ins for @wonderful/ui-base. Its package cannot load in the vitest node env (it imports
 * react-router), so component tests `vi.mock("@wonderful/ui-base", () => import(".../uiStub"))` and render
 * to static markup. Each component renders `<ui-name data-prop=...>` with its node props and children inline,
 * so tests can assert on visible text, labels and which actions exist.
 */
import { createElement, isValidElement, type ReactNode } from "react";

type AnyProps = Record<string, unknown> & { children?: ReactNode };
const NODE_PROPS = ["title", "description", "actions", "action", "footer", "prefix", "suffix", "icon", "avatar", "label", "text", "value"];

function renderList(key: string, list: unknown[]): ReactNode[] {
  return list.map((item, i) => {
    if (isValidElement(item)) return item;
    const o = (item ?? {}) as Record<string, unknown>;
    return createElement(`ui-${key}-item`, { key: i, "data-value": typeof o.value === "string" ? o.value : undefined }, o.label as ReactNode, o.content as ReactNode);
  });
}

function createStub(name: string) {
  const tag = `ui-${name.toLowerCase().replace(/\./g, "-")}`;
  const C = (props: AnyProps) => {
    const attrs: Record<string, unknown> = {};
    const kids: ReactNode[] = [];
    for (const [k, v] of Object.entries(props)) {
      if (k === "children" || typeof v === "function") continue;
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") attrs[`data-${k.toLowerCase()}`] = String(v);
      if (Array.isArray(v)) kids.push(createElement(`ui-${k.toLowerCase()}`, { key: k }, ...renderList(k.toLowerCase(), v)));
      else if (NODE_PROPS.includes(k) && (isValidElement(v) || typeof v === "string" || typeof v === "number")) kids.push(createElement(`ui-slot`, { key: k, "data-slot": k }, v as ReactNode));
    }
    if (typeof props.onClick === "function") attrs["data-clickable"] = "true";
    return createElement(tag, attrs, ...kids, props.children);
  };
  C.displayName = name;
  return C;
}

const withParts = <P extends string>(name: string, parts: readonly P[]) =>
  Object.assign(createStub(name), Object.fromEntries(parts.map((p) => [p, createStub(`${name}.${p}`)])) as Record<P, ReturnType<typeof createStub>>);

const card = withParts("Card", ["Header", "Content", "Footer", "Meta", "List", "Title", "Description", "Stat"] as const);
export const Card = Object.assign(card, { List: Object.assign(card.List, { Item: createStub("Card.List.Item") }) });
export const Page = withParts("Page", ["Header", "Section", "Toolbar", "Footer"] as const);
export const Layout = withParts("Layout", ["Stack", "Row", "Grid", "Center"] as const);
export const Skeleton = withParts("Skeleton", ["Text", "Circle"] as const);
export const ToggleGroup = withParts("ToggleGroup", ["Item"] as const);
export const Modal = withParts("Modal", ["Footer"] as const);
export const Text = withParts("Text", ["Inline", "Paragraph", "Heading"] as const);
export const Alert = createStub("Alert");
export const Badge = createStub("Badge");
export const Button = createStub("Button");
export const EmptyState = createStub("EmptyState");
export const Icon = createStub("Icon");
export const InputText = createStub("InputText");
export const TextArea = createStub("TextArea");
export const Select = createStub("Select");
export const Tag = createStub("Tag");
export const Notice = createStub("Notice");
export const Hr = createStub("Hr");
export const Elevation = createStub("Elevation");
export const Descriptions = createStub("Descriptions");
export const Progress = createStub("Progress");
