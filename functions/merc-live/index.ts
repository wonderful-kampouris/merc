// Merc fn:merc-live wrapper (WebSocket function: entrypoint main(context, event)). The logic lives in the Merc
// monorepo (shared/handlers/src/merc-live.ts + shared/live + shared/core), bundled into ./handler.gen.js by
// `pnpm --dir shared/handlers bundle merc-live`. Edit there, not here.
import { main as handleEvent } from "./handler.gen.js";

async function main(context: any, event: any): Promise<any> {
  return handleEvent(context, event);
}
