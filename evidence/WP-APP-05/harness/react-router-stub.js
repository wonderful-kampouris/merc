// Screenshot harness only: @wonderful/ui-base imports useSearchParams from react-router (BaseUrlTabs), which is
// not installed in app/app, so the Vite dev server cannot pre-bundle ui-base. The production bundle tree-shakes it.
export function useSearchParams() {
  return [new URLSearchParams(globalThis.location?.search ?? ""), () => {}];
}
