// WP-SPK-05 spike: one business-layer module consumed by BOTH an agent tool and a Function.
export const MERC_SPIKE_CORE_VERSION = "merc-spike-core@1";
export function sumLinesMinor(lines: Array<{ qty: number; unit_price_minor: number }>): number {
  return lines.reduce((s, l) => s + Math.round(l.qty) * Math.round(l.unit_price_minor), 0);
}
