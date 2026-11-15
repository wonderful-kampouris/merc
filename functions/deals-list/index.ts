// Merc fn:deals-list wrapper. The logic lives in the Merc monorepo (shared/handlers/src/deals-list.ts + shared/core),
// bundled into ./handler.gen.js by `pnpm --dir shared/handlers bundle deals-list`. Edit there, not here.
import { handle } from "./handler.gen.js";

async function userFunction(context: any): Promise<any> {
  return handle(context);
}
