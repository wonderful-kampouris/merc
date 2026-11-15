// Merc fn:approval-decide wrapper. The logic lives in the Merc monorepo (shared/handlers/src/approval-decide.ts + shared/core),
// bundled into ./handler.gen.js by `pnpm --dir shared/handlers bundle approval-decide`. Edit there, not here.
import { handle } from "./handler.gen.js";

async function userFunction(context: any): Promise<any> {
  return handle(context);
}
