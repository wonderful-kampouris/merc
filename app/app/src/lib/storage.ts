/** localStorage/sessionStorage access that never throws (Shadow DOM hosts, private mode, tests). */
type Store = "local" | "session";
const get = (s: Store): Storage | undefined => {
  try {
    return s === "local" ? globalThis.localStorage : globalThis.sessionStorage;
  } catch {
    return undefined;
  }
};
export function readStored(key: string, store: Store = "local"): string | null {
  try {
    return get(store)?.getItem(key) ?? null;
  } catch {
    return null;
  }
}
export function writeStored(key: string, value: string | null, store: Store = "local"): void {
  try {
    const s = get(store);
    if (value === null) s?.removeItem(key);
    else s?.setItem(key, value);
  } catch {
    /* storage unavailable: preference lasts for this page only */
  }
}
export function readQuery(name: string): string | null {
  try {
    return new URLSearchParams(globalThis.location?.search ?? "").get(name);
  } catch {
    return null;
  }
}
