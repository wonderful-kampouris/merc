/**
 * The result of a write (approve, undo, move...) is kept over the server list until the server's own copy of
 * that row changes. Contract mocks are stateless and screens poll, so without this a refetch would undo the
 * change on screen; against the real functions the server copy changes right away and the override drops.
 */
export interface Override<T> {
  /** JSON of the server row when the write happened. */
  before: string;
  after: T;
}
export type Overrides<T> = ReadonlyMap<string, Override<T>>;

export function createOverride<T>(map: Overrides<T>, id: string, serverRow: T | undefined, after: T): Map<string, Override<T>> {
  const next = new Map(map);
  next.set(id, { before: serverRow === undefined ? "" : JSON.stringify(serverRow), after });
  return next;
}

/** Server rows with live overrides applied; an override whose server row has since changed is ignored. */
export function getMerged<T>(rows: readonly T[], idOf: (row: T) => string, map: Overrides<T>): T[] {
  if (!map.size) return [...rows];
  return rows.map((row) => {
    const o = map.get(idOf(row));
    return o && o.before === JSON.stringify(row) ? o.after : row;
  });
}
