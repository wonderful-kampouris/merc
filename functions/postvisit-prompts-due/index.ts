// Merc fn:postvisit-prompts-due wrapper. The logic lives in the Merc monorepo (shared/handlers/src/postvisit-prompts-due.ts + shared/core),
// bundled into ./handler.gen.js by `pnpm --dir shared/handlers bundle postvisit-prompts-due`. Edit there, not here.
import { handle } from "./handler.gen.js";

async function userFunction(context: any): Promise<any> {
  return handle(context);
}
