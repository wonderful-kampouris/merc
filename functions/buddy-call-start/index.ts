// Merc fn:buddy-call-start wrapper. The logic lives in the Merc monorepo (shared/handlers/src/buddy-call-start.ts + shared/core),
// bundled into ./handler.gen.js by `pnpm --dir shared/handlers bundle buddy-call-start`. Edit there, not here.
import { handle } from "./handler.gen.js";

async function userFunction(context: any): Promise<any> {
  return handle(context);
}
