// Merc fn:settings-get wrapper. The logic lives in the Merc monorepo (shared/handlers/src/settings-get.ts + shared/core),
// bundled into ./handler.gen.js by `pnpm --dir shared/handlers bundle settings-get`. Edit there.
import { handle } from "./handler.gen.js";

async function userFunction(context: any): Promise<any> {
  return handle(context);
}
