// Merc fn:territory-upsert wrapper. The logic lives in the Merc monorepo (shared/handlers/src/territory-upsert.ts + shared/core),
// bundled into ./handler.gen.js by `pnpm --dir shared/handlers bundle territory-upsert`. Edit there.
import { handle } from "./handler.gen.js";

async function userFunction(context: any): Promise<any> {
  return handle(context);
}
