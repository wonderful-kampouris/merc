// Merc fn:import-get wrapper. The logic lives in the Merc monorepo (shared/handlers/src/import-get.ts + shared/core),
// bundled into ./handler.gen.js by `pnpm --dir shared/handlers bundle import-get`. Edit there, not here.
import { handle } from "./handler.gen.js";

async function userFunction(context: any): Promise<any> {
  return handle(context);
}
