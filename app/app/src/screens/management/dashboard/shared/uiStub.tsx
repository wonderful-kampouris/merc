/**
 * Test-only stand-in for @wonderful/ui-base: ui-base imports react-router (not installed in this app) at module
 * load, so node tests cannot import it. Every component renders a plain element that keeps its text props
 * (title, description, value, label, text, options) visible, which is what the screen tests assert on.
 * Use: `vi.mock("@wonderful/ui-base", () => import("../dashboard/shared/uiStub"))`.
 */
import { createElement as h, isValidElement, type ReactNode } from "react";

type P = Record<string, unknown> & { children?: ReactNode };
const SKIP = new Set(["children", "onClick", "onChange", "onClose", "prefix", "icon", "actions", "footer", "avatar", "options", "value", "title", "description", "label", "text", "content", "data", "columns", "rowKey"]);

function el(name: string, tag = "div") {
  const C = (p: P) => {
    const attrs: Record<string, unknown> = { "data-ui": name };
    for (const [k, v] of Object.entries(p)) if ((k.startsWith("aria-") || k.startsWith("data-")) && !SKIP.has(k)) attrs[k] = v;
    if (tag === "button" && typeof p.onClick === "function") attrs.type = "button";
    const parts: ReactNode[] = [];
    for (const k of ["title", "description", "label", "text", "value"] as const) {
      const v = p[k];
      if (typeof v === "string" || typeof v === "number" || isValidElement(v)) {
        parts.push(h("span", { key: k, "data-prop": k }, isValidElement(v) ? v : String(v)));
      }
    }
    if (Array.isArray(p.options)) parts.push(h("span", { key: "opts", "data-prop": "options" }, (p.options as { label: string }[]).map((o) => o.label).join("|")));
    for (const k of ["prefix", "icon", "actions", "footer", "avatar"] as const) if (isValidElement(p[k])) parts.push(h("span", { key: k, "data-slot": k }, p[k] as ReactNode));
    return h(tag, attrs, ...parts, p.children);
  };
  C.displayName = name;
  return C;
}

const withParts = <T extends Record<string, unknown>>(base: ReturnType<typeof el>, parts: T) => Object.assign(base, parts);

export const Page = withParts(el("Page"), { Header: el("Page.Header"), Toolbar: el("Page.Toolbar"), Section: el("Page.Section"), Footer: el("Page.Footer") });
export const Card = withParts(el("Card"), {
  Header: el("Card.Header"),
  Content: el("Card.Content"),
  Footer: el("Card.Footer"),
  List: withParts(el("Card.List"), { Item: el("Card.List.Item") }),
  Meta: el("Card.Meta"),
  Stat: withParts(el("Card.Stat"), { Delta: el("Card.Stat.Delta") }),
  Box: el("Card.Box"),
});
export const Layout = withParts(el("Layout"), { Stack: el("Layout.Stack"), Row: el("Layout.Row"), Grid: el("Layout.Grid"), Center: el("Layout.Center") });
export const Modal = withParts(el("Modal"), { Footer: el("Modal.Footer") });
export const ToggleGroup = withParts(el("ToggleGroup"), { Item: el("ToggleGroup.Item", "button") });
export const Skeleton = withParts(el("Skeleton"), { Text: el("Skeleton.Text"), Circle: el("Skeleton.Circle") });
export const Progress = el("Progress");
export const Button = el("Button", "button");
export const Badge = el("Badge");
export const Text = el("Text", "span");
export const Icon = el("Icon", "i");
export const Tooltip = el("Tooltip");
export const Select = el("Select");
export const InputText = el("InputText");
export const InputNumber = el("InputNumber");
export const Notice = el("Notice");
export const EmptyState = el("EmptyState");
export const Tag = el("Tag");
export const Hr = el("Hr");
export const Avatar = el("Avatar");
export const AvatarFallback = el("AvatarFallback", "span");
export const Descriptions = el("Descriptions");
