// Merc fn:visit-plan-get wrapper. The logic lives in the Merc monorepo (shared/handlers/src/visit-plan-get.ts + shared/core),
// bundled into ./handler.gen.js by `pnpm --dir shared/handlers bundle visit-plan-get`. Edit there, not here.
import { handle } from "./handler.gen.js";

async function userFunction(context: any): Promise<any> {
  return handle(context);
}
