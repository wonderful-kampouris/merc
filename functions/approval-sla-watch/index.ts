// Merc fn:approval-sla-watch wrapper. The logic lives in the Merc monorepo (shared/handlers/src/approval-sla-watch.ts + shared/core),
// bundled into ./handler.gen.js by `pnpm --dir shared/handlers bundle approval-sla-watch`. Edit there, not here.
import { handle } from "./handler.gen.js";

async function userFunction(context: any): Promise<any> {
  return handle(context);
}
