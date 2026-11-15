// Merc fn:eod-summary wrapper. The logic lives in the Merc monorepo (shared/handlers/src/eod-summary.ts + shared/core + shared/llm),
// bundled into ./handler.gen.js by `pnpm --dir shared/handlers bundle eod-summary`. Edit there, not here.
import { handle } from "./handler.gen.js";

async function userFunction(context: any): Promise<any> {
  return handle(context);
}
