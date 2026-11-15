// Merc fn:dashboard-kpis wrapper. The logic lives in the Merc monorepo (shared/handlers/src/dashboard-kpis.ts + shared/core),
// bundled into ./handler.gen.js by `pnpm --dir shared/handlers bundle dashboard-kpis`. Edit there, not here.
import { handle } from "./handler.gen.js";

async function userFunction(context: any): Promise<any> {
  return handle(context);
}
