// Merc fn:voice-log-upload wrapper. The logic lives in the Merc monorepo (shared/handlers/src/voice-log-upload.ts +
// shared/core + shared/live), bundled into ./handler.gen.js by `pnpm --dir shared/handlers bundle voice-log-upload`.
// Edit there, not here. The LangChain runtime is passed in for the inline-audio transcription (spike S4).
import { LangChainCore, LangChainGoogleGenAI, ModelProfiles } from "@wonderful/types/langchain";
import { handle } from "./handler.gen.js";

async function userFunction(context: any): Promise<any> {
  return handle(context, { LangChainCore, LangChainGoogleGenAI, ModelProfiles } as any);
}
