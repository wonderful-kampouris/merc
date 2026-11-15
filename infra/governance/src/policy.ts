// Governance safety net for external sends (docs/03-progress.md 7.3, REQ-OPS-003 family, WP-QA-02).
// Merc's own rule is that a customer message only leaves after a human approved it in Merc (fn:approval-resolve).
// This platform policy is the second lock: every Gmail send through a Merc Integration Hub connection needs the
// initiating Wonderful user's approval, and a send with no initiating user (cron, procedure, a bug) is blocked.
// Built from `wful integrations schema --json`, so connection ids and input_schema_hash are never hand-copied.

export const POLICY_NAME = "merc-external-send-approval";
/** Integration actions that send something to a person outside Merc (contracts/platform/platform.json#integrations). */
export const SEND_ACTIONS = ["google_workspace_gmail_message_send", "send_mail"] as const;
export const CONNECTION_PREFIX = "merc-";

export interface SchemaAction { action_key: string; classification?: string; input_schema_hash: string; enabled?: boolean }
export interface SchemaConnection { id?: string; connection_id?: string; name: string; status?: string; actions?: SchemaAction[] }
export interface ActionTarget { connection_id: string; action_key: string; input_schema_hash: string }

export interface ActionPolicy {
  name: string; description: string; policy_target: "action"; scope: "global"; mode: "enforce" | "observe"; active: boolean;
  definition: { schema_version: 1; selectors: { origins: never[]; action_targets: ActionTarget[] }; evaluators: never[]; effect: { outcome: "require_approval" | "block" } };
}

export function connectionsOf(schema: unknown): SchemaConnection[] {
  if (Array.isArray(schema)) return schema as SchemaConnection[];
  const s = schema as { connections?: SchemaConnection[]; items?: SchemaConnection[] } | null;
  return s?.connections ?? s?.items ?? [];
}

/** Every send action on every Merc connection. Throws if there is none, so a renamed connection cannot leave the net empty. */
export function sendTargets(schema: unknown): ActionTarget[] {
  const out: ActionTarget[] = [];
  for (const c of connectionsOf(schema)) {
    if (!c.name?.startsWith(CONNECTION_PREFIX)) continue;
    const id = c.connection_id ?? c.id;
    if (!id) continue;
    for (const a of c.actions ?? []) {
      if (!(SEND_ACTIONS as readonly string[]).includes(a.action_key) || a.enabled === false) continue;
      if (!/^sha256:[0-9a-f]{64}$/.test(a.input_schema_hash)) throw new Error(`connection ${c.name}: ${a.action_key} has no valid input_schema_hash`);
      out.push({ connection_id: id, action_key: a.action_key, input_schema_hash: a.input_schema_hash });
    }
  }
  if (!out.length) throw new Error(`no ${SEND_ACTIONS.join("/")} action on any ${CONNECTION_PREFIX}* connection: nothing to govern`);
  return out.sort((x, y) => (x.connection_id + x.action_key).localeCompare(y.connection_id + y.action_key));
}

export function policyBody(schema: unknown, mode: ActionPolicy["mode"] = "enforce"): ActionPolicy {
  return {
    name: POLICY_NAME,
    description: "Merc safety net (WP-QA-02): every email a Merc connection sends to someone outside the platform needs the initiating user's approval; with no initiating user (cron, procedure) the send is blocked. Merc's in-app approval (fn:approval-resolve) stays the first lock. Source: infra/governance/src/policy.ts",
    policy_target: "action", scope: "global", mode, active: true,
    definition: { schema_version: 1, selectors: { origins: [], action_targets: sendTargets(schema) }, evaluators: [], effect: { outcome: "require_approval" } },
  };
}

/** Fields that must read back as sent. */
export function verifyPolicy(sent: ActionPolicy, got: any): string[] {
  const bad: string[] = [];
  for (const k of ["name", "policy_target", "mode", "active"] as const) if (got?.[k] !== sent[k]) bad.push(`${k}: got ${JSON.stringify(got?.[k])}`);
  if (got?.definition?.effect?.outcome !== sent.definition.effect.outcome) bad.push("effect.outcome");
  const key = (t: ActionTarget) => `${t.connection_id}|${t.action_key}|${t.input_schema_hash}`;
  const have = new Set(((got?.definition?.selectors?.action_targets ?? []) as ActionTarget[]).map(key));
  for (const t of sent.definition.selectors.action_targets) if (!have.has(key(t))) bad.push(`missing target ${t.action_key}@${t.connection_id}`);
  return bad;
}
