// Merc fn:my-performance wrapper. The logic lives in the Merc monorepo (shared/handlers/src/my-performance.ts + shared/core),
// bundled into ./handler.gen.js by `pnpm --dir shared/handlers bundle my-performance`. Edit there, not here.
import { handle } from "./handler.gen.js";

async function userFunction(context: any): Promise<any> {
  return handle(context);
}
