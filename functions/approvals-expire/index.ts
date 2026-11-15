// Merc fn:approvals-expire wrapper. The logic lives in the Merc monorepo (shared/handlers/src/approvals-expire.ts + shared/core),
// bundled into ./handler.gen.js by `pnpm --dir shared/handlers bundle approvals-expire`. Edit there, not here.
import { handle } from "./handler.gen.js";

async function userFunction(context: any): Promise<any> {
  return handle(context);
}
