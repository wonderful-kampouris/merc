import { LangChainCore, LangChainGoogleGenAI, ModelProfiles } from "@wonderful/types/langchain";

// Spike S4 (WP-SPK-02): transcribe an uploaded audio clip (base64, <= 1 MB body)
// with an inline-audio chat model. Tries each candidate model in order and
// reports every attempt so the spike can see what works.
const PROMPT =
  "Transcribe this audio recording verbatim in its original language (likely Greek). " +
  "Return only the transcript text, no commentary.";

async function userFunction(context: FunctionContext): Promise<Result> {
  const audio = String(context.data.audio_base64 ?? "");
  const mime = String(context.data.audio_mime ?? "audio/mp4");
  if (!audio) return { error: "audio_base64 required" };
  const requested = context.data.profiles ? String(context.data.profiles).split(",") : [];
  const candidates: { kind: "profile" | "legacy"; ref: string }[] = [
    ...requested.map((ref) => ({ kind: "profile" as const, ref })),
    { kind: "legacy", ref: "gemini-2.5-flash" },
  ];
  const attempts: any[] = [];
  for (const c of candidates) {
    const t0 = Date.now();
    try {
      const model =
        c.kind === "profile"
          ? new ModelProfiles.ChatModel({ profile: c.ref, temperature: 0 })
          : new LangChainGoogleGenAI.ChatGoogleGenerativeAI({ model: c.ref, temperature: 0 });
      const res: any = await model.invoke([
        new LangChainCore.HumanMessage({
          content: [
            { type: "text", text: PROMPT },
            { type: "media", mimeType: mime, data: audio },
          ] as any,
        }),
      ]);
      const text = typeof res.content === "string" ? res.content : JSON.stringify(res.content);
      attempts.push({ ...c, ok: true, ms: Date.now() - t0 });
      return { transcript: text.trim(), model: c, audio_bytes: Math.floor((audio.length * 3) / 4), mime, attempts };
    } catch (err) {
      attempts.push({ ...c, ok: false, ms: Date.now() - t0, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { transcript: null, attempts };
}
