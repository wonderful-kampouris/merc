import { useCallback, useEffect, useRef, useState } from "react";

export type ResourceState<T> =
  | { status: "loading" }
  | { status: "error"; error: unknown }
  | { status: "ready"; data: T; refreshing: boolean };

/**
 * Loads `load()` whenever `key` changes. `reload()` refreshes silently (keeps the data on screen, and keeps it
 * when a background refresh fails, e.g. polling while offline); `reload(false)` shows the loading state again.
 * Only the latest request may update the state.
 */
export function useResource<T>(load: () => Promise<T>, key: string) {
  const [state, setState] = useState<ResourceState<T>>({ status: "loading" });
  const seq = useRef(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  const reload = useCallback(async (silent = true): Promise<void> => {
    const n = ++seq.current;
    setState((s) => (silent && s.status === "ready" ? { ...s, refreshing: true } : { status: "loading" }));
    try {
      const data = await loadRef.current();
      if (n === seq.current) setState({ status: "ready", data, refreshing: false });
    } catch (error) {
      if (n === seq.current) setState((s) => (silent && s.status === "ready" ? { ...s, refreshing: false } : { status: "error", error }));
    }
  }, []);

  useEffect(() => {
    void reload(false);
  }, [key, reload]);

  return { state, reload };
}
