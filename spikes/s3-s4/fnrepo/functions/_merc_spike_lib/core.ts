// WP-SPK-05 spike: a "business layer" module with no config.json, imported relatively.
export type Caller = { source: string; user_id: string | null; email: string | null; raw_keys: string[] };

export function callerFrom(meta: any): Caller {
  const u = meta?.user ?? null;
  return {
    source: u ? "context.metadata.user" : "none",
    user_id: u?.id ?? null,
    email: u?.email ?? null,
    raw_keys: u ? Object.keys(u) : [],
  };
}

export function sumLines(lines: Array<{ qty: number; unit_price_minor: number }>): number {
  return lines.reduce((s, l) => s + l.qty * l.unit_price_minor, 0);
}
