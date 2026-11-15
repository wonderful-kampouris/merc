// Merc fn:product-lookup wrapper. The logic lives in the Merc monorepo (shared/handlers/src/product-lookup.ts + shared/core),
// bundled into ./handler.gen.js by `pnpm --dir shared/handlers bundle product-lookup`. Edit there, not here.
import { handle } from "./handler.gen.js";

async function userFunction(context: any): Promise<any> {
  return handle(context);
}
