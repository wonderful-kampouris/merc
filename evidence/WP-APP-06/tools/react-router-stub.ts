// Stand-in for the optional peer `react-router` of @wonderful/ui-base (only BaseUrlTabs uses useSearchParams).
// Used by the WP-APP-07 render tests and screenshot server only; the shipped bundle is unaffected.
export function useSearchParams(): [URLSearchParams, (next: URLSearchParams) => void] {
  return [new URLSearchParams(), () => {}];
}
