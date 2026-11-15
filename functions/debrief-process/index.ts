// Merc fn:debrief-process wrapper. The logic lives in the Merc monorepo (shared/handlers/src/debrief-process.ts + shared/core),
// bundled into ./handler.gen.js by `pnpm --dir shared/handlers bundle debrief-process`. Edit there, not here.
import { handle } from "./handler.gen.js";

async function userFunction(context: any): Promise<any> {
  return handle(context);
}
