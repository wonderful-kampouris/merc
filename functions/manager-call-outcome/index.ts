// Merc fn:manager-call-outcome wrapper. The logic lives in the Merc monorepo (shared/handlers/src/manager-call-outcome.ts + shared/core),
// bundled into ./handler.gen.js by `pnpm --dir shared/handlers bundle manager-call-outcome`. Edit there, not here.
import { handle } from "./handler.gen.js";

async function userFunction(context: any): Promise<any> {
  return handle(context);
}
