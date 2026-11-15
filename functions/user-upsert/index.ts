// Merc fn:user-upsert wrapper. The logic lives in the Merc monorepo (shared/handlers/src/user-upsert.ts + shared/core),
// bundled into ./handler.gen.js by `pnpm --dir shared/handlers bundle user-upsert`. Edit there.
import { handle } from "./handler.gen.js";

async function userFunction(context: any): Promise<any> {
  return handle(context);
}
