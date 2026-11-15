import { useCallback, useState } from "react";
import { createOverride, getMerged, type Overrides } from "./overrides";

/** Keeps write results over a server list (see overrides.ts). */
export function useOverrides<T>(idOf: (row: T) => string) {
  const [map, setMap] = useState<Overrides<T>>(() => new Map());
  const record = useCallback((id: string, serverRow: T | undefined, after: T) => setMap((m) => createOverride(m, id, serverRow, after)), []);
  const merge = useCallback((rows: readonly T[]) => getMerged(rows, idOf, map), [idOf, map]);
  return { record, merge };
}
