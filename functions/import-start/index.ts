// Merc fn:import-start wrapper. The logic lives in the Merc monorepo (shared/handlers/src/import-start.ts + shared/core + shared/llm),
// bundled into ./handler.gen.js by `pnpm --dir shared/handlers bundle import-start`. Edit there, not here.
// The LangChain runtime namespaces are exposed on globalThis for shared/llm callStructured (inline import-analyze: import_mapping, merc-extract).
import { LangChainCore, ModelProfiles } from "@wonderful/types/langchain";
import { handle } from "./handler.gen.js";

async function userFunction(context: any): Promise<any> {
  const g = globalThis as any;
  g.ModelProfiles ??= ModelProfiles;
  g.LangChainCore ??= LangChainCore;
  return handle(context);
}
