// Merc fn:territories-list wrapper. The logic lives in the Merc monorepo (shared/handlers/src/territories-list.ts + shared/core),
// bundled into ./handler.gen.js by `pnpm --dir shared/handlers bundle territories-list`. Edit there.
import { handle } from "./handler.gen.js";

async function userFunction(context: any): Promise<any> {
  return handle(context);
}
