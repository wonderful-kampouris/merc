// Merc fn:visit-plan-accept wrapper. The logic lives in the Merc monorepo (shared/handlers/src/visit-plan-accept.ts + shared/core),
// bundled into ./handler.gen.js by `pnpm --dir shared/handlers bundle visit-plan-accept`. Edit there, not here.
import { handle } from "./handler.gen.js";

async function userFunction(context: any): Promise<any> {
  return handle(context);
}
