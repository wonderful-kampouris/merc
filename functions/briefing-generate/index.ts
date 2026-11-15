// Merc fn:briefing-generate cron wrapper. The logic lives in the Merc monorepo (shared/handlers/src/briefing-generate.ts
// + shared/core + shared/llm + shared/live), bundled into ./handler.gen.js by `pnpm --dir shared/handlers bundle briefing-generate`.
import { handle } from "./handler.gen.js";

async function userFunction(context: any): Promise<any> {
  return handle(context);
}
