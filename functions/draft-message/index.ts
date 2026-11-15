// Merc fn:draft-message wrapper. The logic lives in the Merc monorepo (shared/handlers/src/draft-message.ts + shared/core),
// bundled into ./handler.gen.js by `pnpm --dir shared/handlers bundle draft-message`. Edit there, not here.
import { handle } from "./handler.gen.js";

async function userFunction(context: any): Promise<any> {
  return handle(context);
}
