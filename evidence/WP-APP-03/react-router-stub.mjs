// Screenshot server only: ui-base's BaseUrlTabs imports useSearchParams from react-router (not installed, unused here).
export function useSearchParams() {
  return [new URLSearchParams(globalThis.location?.search ?? ""), () => undefined];
}
