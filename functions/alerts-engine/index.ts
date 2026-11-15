// Merc fn:alerts-engine wrapper. The logic lives in the Merc monorepo (shared/handlers/src/alerts-engine.ts + shared/core),
// bundled into ./handler.gen.js by `pnpm --dir shared/handlers bundle alerts-engine`. Edit there, not here.
import { handle } from "./handler.gen.js";

async function userFunction(context: any): Promise<any> {
  return handle(context);
}
