// Merc fn:debrief-result-get wrapper. The logic lives in the Merc monorepo (shared/handlers/src/debrief-result-get.ts + shared/core),
// bundled into ./handler.gen.js by `pnpm --dir shared/handlers bundle debrief-result-get`. Edit there, not here.
import { handle } from "./handler.gen.js";

async function userFunction(context: any): Promise<any> {
  return handle(context);
}
