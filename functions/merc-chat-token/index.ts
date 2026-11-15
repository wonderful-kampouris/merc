// Merc fn:merc-chat-token wrapper. The logic lives in the Merc monorepo (shared/handlers/src/merc-chat-token.ts
// + shared/core), bundled into ./handler.gen.js by `pnpm --dir shared/handlers bundle merc-chat-token`.
import { handle } from "./handler.gen.js";

async function userFunction(context: any): Promise<any> {
  return handle(context);
}
