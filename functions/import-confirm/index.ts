// Merc fn:import-confirm wrapper. The logic lives in the Merc monorepo (shared/handlers/src/import-confirm.ts + shared/core),
// bundled into ./handler.gen.js by `pnpm --dir shared/handlers bundle import-confirm`. Edit there, not here.
import { handle } from "./handler.gen.js";

async function userFunction(context: any): Promise<any> {
  return handle(context);
}
