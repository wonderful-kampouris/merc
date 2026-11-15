// Screenshot-harness fixture only (not shipped): the generic contract mock for fn:debrief-result-get samples
// every ActionLine as "suggested", so the card never offers undo. This wraps the app's contracts module for the
// shots bundle and returns a schema-valid card with applied + undoable lines, so REQ-DEB-003 undo can be shown.
// Every reply is still checked with validateResponse, so the fixture cannot drift from the contract.
export * from "../../app/app/src/contracts/index.ts";
import { callMock as realCallMock, validateResponse, type FunctionSlug, type MockOptions } from "../../app/app/src/contracts/index.ts";

const el = () => (globalThis.localStorage?.getItem("merc.lang") ?? "el") !== "en";

function card(voiceLogId: string) {
  const g = el();
  return {
    voice_log_id: voiceLogId,
    account: { id: "3f0b5a52-6a3c-4d0e-9a51-1c2f3e4d5a61", name: g ? "Καφεκοπτείο Μίλτος" : "Miltos Coffee Roasters", account_type: "customer" as const },
    lines: [
      { ai_action_id: "a1d7c2e4-1b3f-4c5d-8e9f-0a1b2c3d4e51", action_type: "visit.log", action_class: "internal", status: "applied", summary: g ? "Καταχωρήθηκε επίσκεψη: ο μύλος επισκευάστηκε" : "Visit logged: grinder repaired", target_table: "visit", target_id: "b2e8d3f5-2c4a-4d6e-9fa0-1b2c3d4e5f62", undoable: true, approval_id: null },
      { ai_action_id: "a1d7c2e4-1b3f-4c5d-8e9f-0a1b2c3d4e52", action_type: "task.create", action_class: "internal", status: "applied", summary: g ? "Εργασία: δείγματα την Πέμπτη" : "Task: bring samples on Thursday", target_table: "task", target_id: "b2e8d3f5-2c4a-4d6e-9fa0-1b2c3d4e5f63", undoable: true, approval_id: null },
      { ai_action_id: "a1d7c2e4-1b3f-4c5d-8e9f-0a1b2c3d4e53", action_type: "order.draft", action_class: "draft", status: "suggested", summary: g ? "Πρόχειρη παραγγελία: 12 κιλά για Πέμπτη" : "Draft order: 12 kg for Thursday", target_table: null, target_id: null, undoable: false, approval_id: null },
    ],
    missing_fields: [],
    pending_approvals: [],
    spoken_summary: g ? "Καταχώρησα την επίσκεψη και μια εργασία για τα δείγματα." : "I logged the visit and a task for the samples.",
    processing_ms: 8400,
  };
}

export function callMock(slug: FunctionSlug, body: unknown = {}, opts: MockOptions = {}) {
  const r = realCallMock(slug, body, opts);
  if (slug !== "debrief-result-get" || !("result" in r)) return r;
  const base = r.result as { account: unknown; missing_fields: unknown; pending_approvals: unknown };
  const c = { ...card((body as { voice_log_id: string }).voice_log_id), missing_fields: base.missing_fields, pending_approvals: base.pending_approvals };
  // keep the seed account ref shape if it validates; otherwise use the sample one
  const withSeed = { ...c, account: base.account };
  const ok = validateResponse(slug, withSeed);
  const result = ok.ok ? withSeed : c;
  const v = validateResponse(slug, result);
  if (!v.ok) throw new Error(`fixture card fails the contract: ${JSON.stringify(v)}`);
  return { result, logs: [...r.logs, "fixture: applied+undoable lines"] } as typeof r;
}
