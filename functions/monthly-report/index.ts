// Merc fn:monthly-report wrapper. The logic lives in the Merc monorepo (shared/handlers/src/monthly-report.ts + shared/core),
// bundled into ./handler.gen.js by `pnpm --dir shared/handlers bundle monthly-report`. Edit there, not here.
import { handle } from "./handler.gen.js";

async function userFunction(context: any): Promise<any> {
  return handle(context);
}
