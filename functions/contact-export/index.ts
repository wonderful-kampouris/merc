// Merc fn:contact-export wrapper. The logic lives in the Merc monorepo (shared/handlers/src/contact-export.ts + shared/core),
// bundled into ./handler.gen.js by `pnpm --dir shared/handlers bundle contact-export`. Edit there.
import { handle } from "./handler.gen.js";

async function userFunction(context: any): Promise<any> {
  return handle(context);
}
