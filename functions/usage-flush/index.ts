// Merc fn:usage-flush wrapper (cron). The logic lives in the Merc monorepo (shared/handlers/src/usage-flush.ts
// + shared/core), bundled into ./handler.gen.js by `pnpm --dir shared/handlers bundle usage-flush`. Edit there.
import { handle } from "./handler.gen.js";

async function userFunction(context: any): Promise<any> {
  return handle(context);
}
