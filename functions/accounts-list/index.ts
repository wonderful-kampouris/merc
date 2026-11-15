// Merc fn:accounts-list wrapper. The logic lives in the Merc monorepo (shared/handlers/src/accounts-list.ts + shared/core),
// bundled into ./handler.gen.js by `pnpm --dir shared/handlers bundle accounts-list`. Edit there, not here.
import { handle } from "./handler.gen.js";

async function userFunction(context: any): Promise<any> {
  return handle(context);
}
