// Merc fn:debrief-confirm-due wrapper. The logic lives in the Merc monorepo (shared/handlers/src/debrief-confirm-due.ts + shared/core),
// bundled into ./handler.gen.js by `pnpm --dir shared/handlers bundle debrief-confirm-due`. Edit there, not here.
import { handle } from "./handler.gen.js";

async function userFunction(context: any): Promise<any> {
  return handle(context);
}
