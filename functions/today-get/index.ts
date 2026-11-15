// Merc fn:today-get wrapper. The logic lives in the Merc monorepo (shared/handlers/src/today-get.ts + shared/core + shared/llm),
// bundled into ./handler.gen.js by `pnpm --dir shared/handlers bundle today-get`. Edit there, not here.
import { handle } from "./handler.gen.js";

async function userFunction(context: any): Promise<any> {
  return handle(context);
}
