// Merc fn:previsit-briefs-due wrapper. The logic lives in the Merc monorepo (shared/handlers/src/previsit-briefs-due.ts + shared/core),
// bundled into ./handler.gen.js by `pnpm --dir shared/handlers bundle previsit-briefs-due`. Edit there, not here.
import { handle } from "./handler.gen.js";

async function userFunction(context: any): Promise<any> {
  return handle(context);
}
