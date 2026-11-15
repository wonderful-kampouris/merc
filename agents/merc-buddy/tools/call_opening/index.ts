// Not a contract tool: OnStart opening for voice sessions (the static voice greeting is disabled in config.json).
// An outbound buddy call the rep asked for ("call me"): mark the buddy_call answered and open with why we called,
// then the morning brief. Any other voice call: the usual greeting. Chat keeps channels.chat.initial_message.
import { s, w } from "@wonderful/types/schema";
import { briefing_get_impl, openCallFromSession, secretString } from "../../lib/merc.gen.js";
import { isTextChannel } from "../../lib/chat-format";
import { NAME_INTERNAL_KEY, runTool, type ToolSpec } from "../../lib/runtime";
import { SPEC as BRIEFING_SPEC } from "../get_briefing/index";

export const GREETING = "Hey, Merc here. Next stop, or log a visit?";
const BRIEF_PURPOSES = new Set(["callback", "briefing"]);

/** script_text of a get_briefing result ({result} wrapped or not); null on error. */
export function scriptOf(res: unknown): string | null {
  const r = res as any;
  const body = r?.result && typeof r.result === "object" ? r.result : r;
  if (!body || body.error) return null;
  const t = typeof body.script_text === "string" ? body.script_text.trim() : "";
  return t || null;
}

/** The brief's own "Hi Nikos! Here's your briefing." opener, dropped because the call opening already greets. */
const SCRIPT_OPENER = /^\s*(?:(?:hi|hey|hello|good (?:morning|afternoon|evening)|γει[αά] σου|καλημέρα)\b[^.!?]*[.!?]\s*)?(?:here'?s your (?:briefing|brief|day)[^.!?]*[.!?]\s*)?/i;
export const withoutOpener = (script: string): string => script.replace(SCRIPT_OPENER, "").trim() || script.trim();

/** The first thing the agent says on this call. */
export function openingLine(open: { kind: string; purpose?: string; reason?: string | null; first_name?: string | null }, script: string | null): string {
  if (open.kind !== "buddy_call") return GREETING;
  const name = open.first_name ? ` ${open.first_name}` : "";
  if (BRIEF_PURPOSES.has(String(open.purpose)) || !open.reason) {
    const hi = `Hi${name}, you asked me to call.`;
    return script ? `${hi} Here's your day. ${withoutOpener(script)}` : `${hi} What do you need?`;
  }
  return `Hi${name}, Merc here. ${open.reason.replace(/\.?$/, ".")}`;
}

export default w.tool({
  name: "call_opening",
  description: "Trigger-only (session start): opening line for voice calls. Never call this tool yourself.",
  trigger: "OnStart",
  params: s.object({}),
  handler: async (ctx: any) => {
    if (isTextChannel(ctx)) return { skipped: "chat keeps its initial message" };
    const key = secretString(ctx, NAME_INTERNAL_KEY);
    const open = key ? await openCallFromSession(ctx, key).catch(() => ({ kind: "inbound" as const })) : { kind: "inbound" as const };
    let script: string | null = null;
    if (open.kind === "buddy_call" && (BRIEF_PURPOSES.has(open.purpose) || !open.reason)) {
      script = scriptOf(await runTool(ctx, BRIEFING_SPEC as ToolSpec, briefing_get_impl, {}, { log: () => {} }).catch(() => null));
    }
    ctx.agent.announce(openingLine(open, script));
    if (open.kind === "buddy_call") {
      ctx.agent.sendSystemMessage(script
        ? "This is the outbound call the rep asked for. You already said why you called and read today's brief. Do not read it again. Next, offer to start with stop 1 (get_visit_brief)."
        : "This is the outbound call the rep asked for. You already said why you called. Help with what they need.");
    }
    return { opening: open.kind, purpose: (open as any).purpose ?? null, briefed: !!script };
  },
});
