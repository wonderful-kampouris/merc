// Merc fn:retention-purge wrapper (cron). The logic lives in the Merc monorepo (shared/handlers/src/retention-purge.ts
// + shared/core), bundled into ./handler.gen.js by `pnpm --dir shared/handlers bundle retention-purge`. Edit there.
import { handle } from "./handler.gen.js";

async function userFunction(context: any): Promise<any> {
  return handle(context);
}
