// The design system's stylesheet, imported here because this is the bundle
// entry — a widget export reaches the bundle without going through `App`, so
// importing it in `App.tsx` would leave widget-only hosts unstyled. The
// `embedded` build keeps Tailwind's cascade layers, so the host page's own
// styles still win over ours. ui-base's component modules carry no CSS imports
// of their own: without this line the whole app renders unstyled.
import "@wonderful/ui-base/embedded.css";

export { default } from "./App";
