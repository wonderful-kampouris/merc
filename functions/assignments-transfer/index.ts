// Merc fn:assignments-transfer wrapper. The logic lives in the Merc monorepo (shared/handlers/src/assignments-transfer.ts + shared/core),
// bundled into ./handler.gen.js by `pnpm --dir shared/handlers bundle assignments-transfer`. Edit there.
import { handle } from "./handler.gen.js";

async function userFunction(context: any): Promise<any> {
  return handle(context);
}
