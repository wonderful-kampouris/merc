// fn:rep-detail (contracts/functions/rep-detail.json, REQ-DSH-003). Gate team.read, scope team.
// One rep's page for a manager: activity and logging discipline (the same KPI engine as fn:dashboard-kpis),
// pipeline, recent visits, recent debriefs and open alerts. OPEN-13 default: managers see debrief results
// (status, account, AI actions applied) but never transcripts or audio, so recent_debriefs has no transcript.
import { assertTeam, defineFunction, type Impl, type Row } from "../../core/src/index";
import { cardsFor } from "./alerts-list";
import { visitSummary } from "./today-get";
import { epochMs, inChunks } from "./metrics-rollup";
import { checkRange, loadFacts, visitDoneDay, voiceLogDay, within1h, zeroCounts } from "./kpi-rollup";
import { periodCounts, repKpis, userRef } from "./dashboard-kpis";

export const RECENT_LIMIT = 10;
export const ALERT_LIMIT = 20;
/** OPEN-13 (SPEC): "Managers see results, not transcripts." Flip only when the decision changes. */
export const TRANSCRIPTS_VISIBLE = false;

export function makeImpl(deps: { now?: () => number } = {}): Impl<"rep-detail"> {
  return async ({ req, db, me }) => {
    checkRange(req.from, req.to);
    assertTeam(me, req.rep_id, "rep");
    const rep = await db.app_user.require(req.rep_id);
    const now = (deps.now ?? Date.now)();
    const f = await loadFacts(db, me, [rep.id], now);
    const { perRep } = await periodCounts(db, f, [rep.id], req.from, req.to);
    const c = perRep.get(rep.id) ?? zeroCounts();

    const inRange = (d: string | null) => !!d && d >= req.from && d <= req.to;
    const periodVisits = f.visits.filter((v) => inRange(v.status === "done" ? visitDoneDay(f, v) : v.planned_date));
    const logs = f.voiceLogs.filter((l) => inRange(voiceLogDay(f, l))).sort((a, b) => String(b.recorded_at).localeCompare(String(a.recorded_at)));
    const visitById = new Map(f.visits.map((v) => [v.id, v]));
    const loggedVisits = new Set(f.voiceLogs.filter((l) => l.visit_id && l.status !== "failed").map((l) => l.visit_id!));
    const doneInPeriod = periodVisits.filter((v) => v.status === "done");
    const openAlertsAll = await db.alert.all({ recipient_id: rep.id, status: "open" });

    const kpis = {
      ...repKpis(f, rep.id, c, req.from, req.to),
      visits_planned: periodVisits.filter((v) => v.status === "planned").length,
      visits_skipped: periodVisits.filter((v) => v.status === "skipped").length,
      visits_without_log: doneInPeriod.filter((v) => !loggedVisits.has(v.id)).length,
      voice_logs_within_1h: c.voice_logs_within_1h,
      voice_logs_failed: logs.filter((l) => l.status === "failed").length,
      open_deals: f.deals.filter((d) => d.owner_id === rep.id && !!f.stages.get(d.stage_code) && !f.stages.get(d.stage_code)!.is_closed).length,
      open_alerts: openAlertsAll.length,
    };

    // Accounts of the visits/logs shown (they may belong to a territory colleague).
    const accIds = [...new Set([...periodVisits.map((v) => v.account_id), ...logs.map((l) => l.account_id).filter((x): x is string => !!x)])];
    const accounts = new Map((await inChunks(accIds, (ch) => db.account.all({ id: ch }))).map((a) => [a.id, a]));
    const recent_visits = [...periodVisits]
      .sort((a, b) => b.planned_date.localeCompare(a.planned_date) || (a.route_position ?? 0) - (b.route_position ?? 0))
      .slice(0, RECENT_LIMIT)
      .map((v) => visitSummary(v, accounts.get(v.account_id)));

    const shown = logs.slice(0, RECENT_LIMIT);
    const actionsByLog = new Map<string, Row<"ai_action">[]>();
    for (const a of f.aiActions) if (a.voice_log_id) (actionsByLog.get(a.voice_log_id) ?? actionsByLog.set(a.voice_log_id, []).get(a.voice_log_id)!).push(a);
    const recent_debriefs = shown.map((l) => {
      const visit = l.visit_id ? visitById.get(l.visit_id) : undefined;
      const acts = actionsByLog.get(l.id) ?? [];
      const acc = l.account_id ? accounts.get(l.account_id) : undefined;
      return {
        voice_log_id: l.id,
        account: acc ? { id: acc.id, name: acc.name, account_type: acc.account_type, postal_code: acc.postal_code ?? null } : null,
        visit_id: l.visit_id ?? null,
        recorded_at: l.recorded_at,
        capture_mode: l.capture_mode,
        status: l.status,
        language: l.language ?? null,
        processing_ms: l.processing_ms ?? null,
        within_1h: l.visit_id ? within1h(l, visit) : false,
        ai_actions_applied: acts.filter((a) => a.status === "applied").length,
        ai_actions_undone: acts.filter((a) => a.status === "undone").length,
        ai_actions: acts.map((a) => ({ id: a.id, action_type_code: a.action_type_code, status: a.status, reason: a.reason ?? null })),
        transcript_visible: TRANSCRIPTS_VISIBLE,
        ...(TRANSCRIPTS_VISIBLE ? { transcript: l.transcript ?? null } : {}),
      };
    });

    const newest = [...openAlertsAll].sort((a, b) => (epochMs(b.created_at) ?? 0) - (epochMs(a.created_at) ?? 0) || a.id.localeCompare(b.id)).slice(0, ALERT_LIMIT);
    const open_alerts = await cardsFor(db, newest);
    return { rep: userRef(rep), kpis, recent_visits, recent_debriefs, open_alerts };
  };
}
export const impl = makeImpl();

/** Wonderful Function entry (functions/rep-detail/index.ts calls this). */
export const handle = defineFunction("rep-detail", impl);
