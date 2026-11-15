// Merc fn:metrics-rollup wrapper. The logic lives in the Merc monorepo (shared/handlers/src/metrics-rollup.ts + shared/core),
// bundled into ./handler.gen.js by `pnpm --dir shared/handlers bundle metrics-rollup`. Edit there, not here.
import { handle } from "./handler.gen.js";

async function userFunction(context: any): Promise<any> {
  return handle(context);
}
