// Merc fn:approver-brief wrapper. The logic lives in the Merc monorepo (shared/handlers/src/approver-brief.ts + shared/core),
// bundled into ./handler.gen.js by `pnpm --dir shared/handlers bundle approver-brief`. Edit there, not here.
import { handle } from "./handler.gen.js";

async function userFunction(context: any): Promise<any> {
  return handle(context);
}
