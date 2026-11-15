// Merc fn:problem-update wrapper. The logic lives in the Merc monorepo (shared/handlers/src/problem-update.ts + shared/core),
// bundled into ./handler.gen.js by `pnpm --dir shared/handlers bundle problem-update`. Edit there, not here.
import { handle } from "./handler.gen.js";

async function userFunction(context: any): Promise<any> {
  return handle(context);
}
