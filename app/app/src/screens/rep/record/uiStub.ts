/**
 * Test-only stand-ins for @wonderful/ui-base (its root import needs react-router, which the vitest node env
 * does not have). Each component renders `<ui-name data-prop=...>` with node props and children inline.
 */
import { createElement, isValidElement, type ReactNode } from "react";

type AnyProps = Record<string, unknown> & { children?: ReactNode };
const NODE_PROPS = ["title", "description", "actions", "action", "prefix", "suffix", "icon", "avatar", "label", "text"];

function stub(name: string) {
  const tag = `ui-${name.toLowerCase().replace(/\./g, "-")}`;
  const C = (props: AnyProps) => {
    const attrs: Record<string, unknown> = {};
    const kids: ReactNode[] = [];
    for (const [k, v] of Object.entries(props)) {
      if (k === "children" || typeof v === "function") continue;
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") attrs[`data-${k.toLowerCase()}`] = String(v);
      if (NODE_PROPS.includes(k) && (typeof v === "string" || typeof v === "number" || isValidElement(v))) kids.push(createElement("ui-slot", { key: k, "data-slot": k }, v as ReactNode));
    }
    if (typeof props.onClick === "function") attrs["data-clickable"] = "true";
    return createElement(tag, attrs, ...kids, props.children);
  };
  C.displayName = name;
  return C;
}
const parts = <P extends string>(name: string, ps: readonly P[]) =>
  Object.assign(stub(name), Object.fromEntries(ps.map((p) => [p, stub(`${name}.${p}`)])) as Record<P, ReturnType<typeof stub>>);

export const Card = parts("Card", ["Header", "Content", "Footer", "Meta", "List"] as const);
export const Page = parts("Page", ["Header", "Section"] as const);
export const Layout = parts("Layout", ["Stack", "Row", "Grid", "Center"] as const);
export const Text = stub("Text");
export const Alert = stub("Alert");
export const Badge = stub("Badge");
export const Button = stub("Button");
export const Icon = stub("Icon");
export const TextArea = stub("TextArea");
export const Notice = stub("Notice");
export const Spinner = stub("Spinner");
