// Screenshot bundle only: ui-base's BaseUrlTabs imports useSearchParams from react-router (not installed, unused by the app).
export function useSearchParams() {
  return [new URLSearchParams(globalThis.location?.search ?? ""), () => undefined];
}
