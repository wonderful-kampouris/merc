// Merc fn:ai-action-undo wrapper. The logic lives in the Merc monorepo (shared/handlers/src/ai-action-undo.ts + shared/autonomy + shared/core),
// bundled into ./handler.gen.js by `pnpm --dir shared/handlers bundle ai-action-undo`. Edit there, not here.
import { handle } from "./handler.gen.js";

async function userFunction(context: any): Promise<any> {
  return handle(context);
}
