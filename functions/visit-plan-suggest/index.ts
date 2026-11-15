// Merc fn:visit-plan-suggest cron wrapper. The logic lives in the Merc monorepo
// (shared/handlers/src/visit-plan-suggest.ts + shared/core + shared/live), bundled into ./handler.gen.js by
// `pnpm --dir shared/handlers bundle visit-plan-suggest`. Edit there, not here.
import { handle } from "./handler.gen.js";

async function userFunction(context: any): Promise<any> {
  return handle(context);
}
