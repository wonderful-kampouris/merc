/**
 * Test-only stand-in for @wonderful/ui-base used by the WP-APP-07 render tests. ui-base imports the optional peer
 * react-router (not installed in app/app) at module load, so plain node `vitest run` cannot import it. Every
 * component renders a plain element that keeps its text props visible, which is what the render tests assert on.
 * Use: `vi.mock("@wonderful/ui-base", () => import("../settings/uiStub"))`.
 */
import { createElement as h, isValidElement, type ReactNode } from "react";

type P = Record<string, unknown> & { children?: ReactNode };
const TEXT = ["title", "description", "label", "text", "value", "placeholder", "message"] as const;
const SLOTS = ["prefix", "icon", "actions", "footer", "avatar", "extra"] as const;

function el(name: string, tag = "div") {
  const C = (p: P) => {
    const attrs: Record<string, unknown> = { "data-ui": name };
    for (const [k, v] of Object.entries(p)) if (k.startsWith("aria-") || k.startsWith("data-")) attrs[k] = v;
    if (tag === "button") attrs.type = "button";
    const parts: ReactNode[] = [];
    for (const k of TEXT) {
      const v = p[k];
      if (typeof v === "string" || typeof v === "number" || isValidElement(v)) parts.push(h("span", { key: k, "data-prop": k }, isValidElement(v) ? v : String(v)));
    }
    for (const k of ["options", "items", "steps", "tabs"] as const) {
      const list = p[k];
      if (Array.isArray(list)) {
        const labels = list.map((o) => (o && typeof o === "object" ? ((o as { label?: unknown; title?: unknown }).label ?? (o as { title?: unknown }).title) : o));
        parts.push(h("span", { key: k, "data-prop": k }, ...labels.map((l, i) => h("span", { key: i }, isValidElement(l) ? l : String(l ?? "")))));
      }
    }
    for (const k of SLOTS) if (isValidElement(p[k])) parts.push(h("span", { key: k, "data-slot": k }, p[k] as ReactNode));
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
});
export const Layout = withParts(el("Layout"), { Stack: el("Layout.Stack"), Row: el("Layout.Row"), Grid: el("Layout.Grid") });
export const Modal = withParts(el("Modal"), { Footer: el("Modal.Footer") });
export const Skeleton = withParts(el("Skeleton"), { Text: el("Skeleton.Text"), Circle: el("Skeleton.Circle") });
export const Alert = el("Alert");
export const Avatar = el("Avatar");
export const AvatarFallback = el("AvatarFallback", "span");
export const Badge = el("Badge", "span");
export const Button = el("Button", "button");
export const Checkbox = el("Checkbox");
export const EmptyState = el("EmptyState");
export const FileUpload = withParts(el("FileUpload"), { Area: el("FileUpload.Area") });
export const Icon = el("Icon", "i");
export const InputNumber = el("InputNumber");
export const InputText = el("InputText");
export const Select = el("Select");
export const Steps = el("Steps");
export const Tabs = el("Tabs");
export const Tag = el("Tag", "span");
export const Text = el("Text", "span");
export const TextArea = el("TextArea");
export const Toggle = el("Toggle");
