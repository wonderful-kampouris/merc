// fn:deal-upsert (contracts/functions/deal-upsert.json, scope account): create a deal or patch one.
// `fields` is a free object in the contract; only the keys below are accepted, each validated here.
// Every stage change (including the first stage of a new deal) writes tbl:deal_stage_history.
import { defineFunction, forbidden, inTeam, invalid, isDate, requireAccount, type Db, type Impl, type Row, type TableRows, type UserPrincipal } from "../../core/src/index";

export const DEAL_FIELDS = ["title", "stage_code", "amount_minor", "expected_close_date", "next_step", "owner_id"] as const;
export const DEFAULT_STAGE = "new";
type DealPatch = Partial<Pick<TableRows["deal"], (typeof DEAL_FIELDS)[number]>>;

/** Validate the contract's free `fields` object into a typed patch (validation_failed lists every problem). */
export function parseDealFields(fields: Record<string, unknown>): DealPatch {
  const errors: string[] = [];
  const out: DealPatch = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    switch (k) {
      case "title":
        if (typeof v !== "string" || !v.trim()) errors.push("title: non-empty string required");
        else if (v.trim().length > 200) errors.push("title: at most 200 characters");
        else out.title = v.trim();
        break;
      case "stage_code":
        if (typeof v !== "string" || !v) errors.push("stage_code: string required");
        else out.stage_code = v;
        break;
      case "amount_minor":
        if (v !== null && !(typeof v === "number" && Number.isInteger(v) && v >= 0)) errors.push("amount_minor: non-negative integer (minor units) or null");
        else out.amount_minor = v as number | null;
        break;
      case "expected_close_date":
        if (v !== null && !isDate(v)) errors.push("expected_close_date: YYYY-MM-DD or null");
        else out.expected_close_date = v as string | null;
        break;
      case "next_step":
        if (v !== null && typeof v !== "string") errors.push("next_step: string or null");
        else out.next_step = typeof v === "string" && v.trim() ? v.trim() : null;
        break;
      case "owner_id":
        if (typeof v !== "string" || !/^[0-9a-f-]{36}$/i.test(v)) errors.push("owner_id: uuid required");
        else out.owner_id = v;
        break;
      default:
        errors.push(`${k}: unknown field (allowed: ${DEAL_FIELDS.join(", ")})`);
    }
  }
  if (errors.length) throw invalid(`invalid deal fields: ${errors.slice(0, 3).join("; ")}`, { errors });
  return out;
}

async function requireStage(db: Db, code: string): Promise<Row<"deal_stage">> {
  const s = await db.deal_stage.get(code);
  if (!s) throw invalid(`unknown deal stage ${code}`, { stage_code: code });
  return s;
}

/** A rep owns only their own deals; a manager may assign to self or the team; an admin to any org user. */
async function checkOwner(db: Db, me: UserPrincipal, ownerId: string): Promise<void> {
  const u = await db.app_user.get(ownerId);
  if (!u || u.status !== "active") throw invalid("owner_id is not an active user of this organization", { owner_id: ownerId });
  if (ownerId !== me.id && me.role !== "admin" && !inTeam(me, ownerId)) throw forbidden("owner is outside your scope", { owner_id: ownerId });
}

export const impl: Impl<"deal-upsert"> = async ({ req, db, me }) => {
  const account = await requireAccount(db, me, req.account_id);
  const patch = parseDealFields(req.fields as Record<string, unknown>);
  const now = new Date().toISOString();
  const history = (deal_id: string, from: string | null, to: string) =>
    db.deal_stage_history.insert({ deal_id, from_stage_code: from, to_stage_code: to, changed_by: me.id, changed_at: now });

  if (req.deal_id) {
    const deal = await db.deal.require(req.deal_id);
    if (deal.account_id !== account.id) throw invalid("deal belongs to another account", { deal_id: deal.id, account_id: account.id });
    if (patch.owner_id && patch.owner_id !== deal.owner_id) await checkOwner(db, me, patch.owner_id);
    const stageChanged = patch.stage_code !== undefined && patch.stage_code !== deal.stage_code;
    const update: Partial<TableRows["deal"]> = { ...patch, last_activity_at: now };
    if (stageChanged) update.closed_at = (await requireStage(db, patch.stage_code!)).is_closed ? now : null;
    await db.deal.update(deal.id, update);
    if (stageChanged) await history(deal.id, deal.stage_code, patch.stage_code!);
    return { deal_id: deal.id };
  }

  if (!patch.title) throw invalid("a new deal needs fields.title", { missing: "title" });
  const stage = await requireStage(db, patch.stage_code ?? DEFAULT_STAGE);
  // Default owner: the rep themself; for a manager/admin creating on a rep's account, that account's owner.
  const owner_id = patch.owner_id ?? (me.role === "rep" ? me.id : account.owner_rep_id ?? me.id);
  await checkOwner(db, me, owner_id);
  const deal = await db.deal.insert({
    ...patch,
    account_id: account.id,
    owner_id,
    title: patch.title,
    stage_code: stage.code,
    last_activity_at: now,
    closed_at: stage.is_closed ? now : null,
  });
  await history(deal.id, null, stage.code);
  return { deal_id: deal.id };
};

export const handle = defineFunction("deal-upsert", impl);
