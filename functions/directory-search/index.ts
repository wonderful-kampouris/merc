// Merc fn:directory-search wrapper. The logic lives in the Merc monorepo (shared/handlers/src/directory-search.ts + shared/core),
// bundled into ./handler.gen.js by `pnpm --dir shared/handlers bundle directory-search`. Edit there, not here.
import { handle } from "./handler.gen.js";

async function userFunction(context: any): Promise<any> {
  return handle(context);
}
