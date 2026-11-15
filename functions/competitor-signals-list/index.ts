// Merc fn:competitor-signals-list wrapper. The logic lives in the Merc monorepo (shared/handlers/src/competitor-signals-list.ts + shared/core),
// bundled into ./handler.gen.js by `pnpm --dir shared/handlers bundle competitor-signals-list`. Edit there, not here.
import { handle } from "./handler.gen.js";

async function userFunction(context: any): Promise<any> {
  return handle(context);
}
