// Merc fn:rep-detail wrapper. The logic lives in the Merc monorepo (shared/handlers/src/rep-detail.ts + shared/core),
// bundled into ./handler.gen.js by `pnpm --dir shared/handlers bundle rep-detail`. Edit there, not here.
import { handle } from "./handler.gen.js";

async function userFunction(context: any): Promise<any> {
  return handle(context);
}
