// Merc fn:visit-card-get wrapper. The logic lives in the Merc monorepo (shared/handlers/src/visit-card-get.ts +
// shared/core + shared/llm), bundled into ./handler.gen.js by `pnpm --dir shared/handlers bundle visit-card-get`.
// Edit there, not here.
import { handle } from "./handler.gen.js";

async function userFunction(context: any): Promise<any> {
  return handle(context);
}
