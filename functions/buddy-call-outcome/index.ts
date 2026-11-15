// Merc fn:buddy-call-outcome wrapper. The logic lives in the Merc monorepo (shared/handlers/src/buddy-call-outcome.ts + shared/core),
// bundled into ./handler.gen.js by `pnpm --dir shared/handlers bundle buddy-call-outcome`. Edit there, not here.
import { handle } from "./handler.gen.js";

async function userFunction(context: any): Promise<any> {
  return handle(context);
}
