import { MERC_SPIKE_CORE_VERSION, sumLinesMinor } from "./shared_lib/utils/merc_spike_core";

// WP-SPK-05 spike: the same shared_lib util, imported from a Function.
async function userFunction(context: FunctionContext): Promise<Result> {
  const lines = Array.isArray((context as any).data?.lines) ? (context as any).data.lines : [];
  return { core: MERC_SPIKE_CORE_VERSION, total_minor: sumLinesMinor(lines) };
}
