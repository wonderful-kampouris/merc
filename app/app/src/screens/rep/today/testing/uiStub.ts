/**
 * Test-only stand-in for @wonderful/ui-base: the real barrel imports react-router (not installed) and needs a DOM.
 * Each component renders a plain element tagged `data-ui="<Name>"` with its text props, so a screen can be
 * rendered with react-dom/server and its content asserted. Used via
 * `vi.mock("@wonderful/ui-base", () => import("../today/testing/uiStub"))`.
 */
import { createElement, type ReactNode } from "react";

type P = Record<string, unknown> & { children?: ReactNode };
const TEXT_PROPS = ["title", "description", "text", "label", "value", "placeholder", "prefix", "suffix", "actions", "avatar", "icon", "action", "header", "footer"] as const;

const make = (name: string, tag = "div") =>
  function Stub(p: P) {
    const extra: ReactNode[] = [];
    for (const k of TEXT_PROPS) {
      const v = p[k];
      if (v === undefined || v === null || v === false) continue;
      if (typeof v === "string" || typeof v === "number") extra.push(createElement("span", { key: k, "data-prop": k }, String(v)));
      else if (typeof v === "object" && !Array.isArray(v)) extra.push(createElement("span", { key: k, "data-prop": k }, v as ReactNode));
    }
    if (Array.isArray(p.actions)) for (const [i, a] of (p.actions as Array<{ label: string }>).entries()) extra.push(createElement("button", { key: `a${i}` }, a.label));
    const attrs: Record<string, unknown> = { "data-ui": name };
    for (const k of ["aria-label", "aria-busy", "aria-expanded", "href", "data-section", "variant", "color"]) if (p[k] !== undefined) attrs[k] = String(p[k]);
    if (p.loading) attrs["data-loading"] = "true";
    return createElement(tag, attrs, ...extra, p.children as ReactNode);
  };

const withParts = <T extends object>(base: ReturnType<typeof make>, parts: T) => Object.assign(base, parts);

export const Page = withParts(make("Page"), { Header: make("Page.Header", "header"), Toolbar: make("Page.Toolbar"), Section: make("Page.Section", "section"), Footer: make("Page.Footer") });
const CardList = withParts(make("Card.List", "ul"), { Item: make("Card.List.Item", "li"), CollapsibleItem: make("Card.List.CollapsibleItem", "li") });
const CardStat = withParts(make("Card.Stat"), { Delta: make("Card.Stat.Delta") });
export const Card = withParts(make("Card"), {
  Header: make("Card.Header"), Content: make("Card.Content"), Body: make("Card.Content"), Footer: make("Card.Footer"), Meta: make("Card.Meta"),
  Stat: CardStat, List: CardList, Box: make("Card.Box"), Title: make("Card.Title"), Description: make("Card.Description"), Cover: make("Card.Cover"),
});
export const Layout = withParts(make("Layout"), { Stack: make("Layout.Stack"), Row: make("Layout.Row"), Grid: make("Layout.Grid"), Center: make("Layout.Center") });
export const Text = withParts(make("Text", "p"), { Inline: make("Text.Inline", "span"), Paragraph: make("Text.Paragraph", "p"), Heading: make("Text.Heading", "h2") });
export const Button = make("Button", "button");
export const Badge = make("Badge", "span");
export const Alert = make("Alert", "aside");
export const Notice = make("Notice", "aside");
export const EmptyState = make("EmptyState");
export const NoResultsState = make("NoResultsState");
export const Skeleton = withParts(make("Skeleton"), { Text: make("Skeleton.Text"), Circle: make("Skeleton.Circle") });
export const Progress = make("Progress");
export const SearchInput = make("SearchInput", "label");
export const InputText = make("InputText", "label");
export const ToggleGroup = withParts(make("ToggleGroup"), { Item: make("ToggleGroup.Item", "button") });
export const Descriptions = withParts(make("Descriptions", "dl"), { Item: make("Descriptions.Item") });
export const Icon = () => createElement("i", { "data-ui": "Icon" });
export const Elevation = (p: P) => createElement("div", { "data-ui": "Elevation" }, p.children as ReactNode);
