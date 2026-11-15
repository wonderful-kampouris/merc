// Merc fn:settings-update wrapper. The logic lives in the Merc monorepo (shared/handlers/src/settings-update.ts + shared/core),
// bundled into ./handler.gen.js by `pnpm --dir shared/handlers bundle settings-update`. Edit there.
import { handle } from "./handler.gen.js";

async function userFunction(context: any): Promise<any> {
  return handle(context);
}
