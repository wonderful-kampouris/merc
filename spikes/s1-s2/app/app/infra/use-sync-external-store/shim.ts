// ESM stand-in for `use-sync-external-store/shim`. The package ships only
// CommonJS, which calls `require("react")`; with React external, the bundler can
// only turn that into a runtime `require` the browser does not have. The shim
// exists for React < 18, and the template's React peer is >= 18, so React's own
// hook is the whole implementation.
export { useSyncExternalStore } from "react";
