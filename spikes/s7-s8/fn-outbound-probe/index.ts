// WP-SPK-04 (S7 + S8) dry-run probe. NEVER dials: the outbound request is sent
// WITHOUT a `to` number, so the platform must reject it before any INVITE.
// Proves: (1) a Function can reach POST /v1/agents/outbound via context.api,
// (2) the payload shape the real fn:discount-request will send,
// (3) a Function can reach POST /v1/communications/{id}/external-events (S8 relay).
async function userFunction(context: FunctionContext): Promise<Result> {
  const d: any = context.data || {};
  const from: string = d.from || "+12763303779"; // only tenant number free for agent assignment
  const approvalId: string = d.approval_id || "00000000-0000-0000-0000-000000000001";
  const fakeComm: string = d.comm_id || "00000000-0000-0000-0000-000000000000";

  // The payload fn:discount-request would send for a live call (minus `to`).
  const outbound: Record<string, any> = {
    from,
    call_purpose: `merc_approval:${approvalId}`,
    answer_timeout_after_progress_seconds: 25,
  };
  // HARD GUARD: never add `to` in this probe.
  if ("to" in outbound) throw new Error("probe must never dial");

  const out: Record<string, any> = { payload_sent: outbound };
  const hasApi = !!(context as any).api;
  out.context_api_present = hasApi;
  if (hasApi) {
    try {
      out.outbound = { ok: true, body: await (context as any).api.post("/v1/agents/outbound", { body: outbound }) };
    } catch (e: any) {
      out.outbound = { ok: false, status: e?.status, message: String(e?.message || e), body: e?.body };
    }
    try {
      out.external_event = {
        ok: true,
        body: await (context as any).api.post(`/v1/communications/${fakeComm}/external-events`, {
          body: {
            event_id: `merc_spike_${approvalId}`,
            type: "merc.approval.decided",
            message: "Eleni approved 4% (not 5%) for Miltos.",
            trigger_turn: true,
            interrupt_current_turn: false,
          },
        }),
      };
    } catch (e: any) {
      out.external_event = { ok: false, status: e?.status, message: String(e?.message || e), body: e?.body };
    }
  }
  return out;
}
