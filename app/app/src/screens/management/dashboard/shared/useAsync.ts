import { useCallback, useEffect, useRef, useState } from "react";

export type AsyncState<T> =
  | { status: "loading"; data?: T }
  | { status: "ok"; data: T }
  | { status: "error"; error: unknown; data?: T };

/**
 * Run `load` when `key` changes; `reload()` runs it again. Stale replies (an older key) are dropped.
 * Keeps the previous data while reloading so filters do not flash the skeleton.
 */
export function useAsync<T>(load: () => Promise<T>, key: string): AsyncState<T> & { reload: () => void } {
  const [state, setState] = useState<AsyncState<T>>({ status: "loading" });
  const [tick, setTick] = useState(0);
  const seq = useRef(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    const mine = ++seq.current;
    setState((s) => ({ status: "loading", data: s.data }));
    loadRef.current().then(
      (data) => {
        if (mine === seq.current) setState({ status: "ok", data });
      },
      (error: unknown) => {
        if (mine === seq.current) setState((s) => ({ status: "error", error, data: s.data }));
      },
    );
  }, [key, tick]);

  const reload = useCallback(() => setTick((n) => n + 1), []);
  return { ...state, reload };
}
