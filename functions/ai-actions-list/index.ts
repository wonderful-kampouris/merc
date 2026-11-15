// Merc fn:ai-actions-list wrapper. The logic lives in the Merc monorepo (shared/handlers/src/ai-actions-list.ts + shared/autonomy + shared/core),
// bundled into ./handler.gen.js by `pnpm --dir shared/handlers bundle ai-actions-list`. Edit there, not here.
import { handle } from "./handler.gen.js";

async function userFunction(context: any): Promise<any> {
  return handle(context);
}
