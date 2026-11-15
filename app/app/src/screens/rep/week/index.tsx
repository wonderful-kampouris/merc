import { useCallback, useState } from "react";
import type { VisitSummary } from "../../../contracts";
import { useScreenI18n } from "../../../lib/i18n";
import type { ScreenProps } from "../../../lib/screenRegistry";
import { getErrorDetail, getErrorKey } from "../approvals/kit/errorKey";
import type { FeedbackMessage } from "../approvals/kit/Feedback";
import { addDays, formatDay } from "../approvals/kit/format";
import { createOverride, type Overrides } from "../approvals/kit/overrides";
import { useResource } from "../approvals/kit/useResource";
import messages from "./i18n";
import { createMoveBody, createReorderBody, createSkipBody, getMergedPlan, type EditState, type Plan, type PlanDay } from "./logic";
import WeekView from "./WeekView";

/** /rep/week: visit-plan-get, visit-plan-accept, visit-update. */
export default function Week({ client }: ScreenProps) {
  const { t, lang } = useScreenI18n(messages);
  const [weekStart, setWeekStart] = useState<string | null>(null);
  const [status, setStatus] = useState<{ planId: string; status: string } | null>(null);
  const [visits, setVisits] = useState<Overrides<VisitSummary>>(() => new Map());
  const [accepting, setAccepting] = useState(false);
  const [edit, setEdit] = useState<EditState | null>(null);
  const [busyVisit, setBusyVisit] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<FeedbackMessage | null>(null);
  const { state, reload } = useResource(() => client.call("visit-plan-get", { week_start: weekStart }), `week:${weekStart ?? "current"}`);
  const fail = (e: unknown) => setFeedback({ kind: "error", text: `${t("actionFailed")}. ${t(getErrorKey(e))}`, detail: getErrorDetail(e) });

  const findServerVisit = useCallback(
    (id: string) => (state.status === "ready" ? state.data.days.flatMap((d) => d.visits).find((v) => v.visit_id === id) : undefined),
    [state],
  );

  const update = async (body: Parameters<typeof client.call<"visit-update">>[1], done: (v: VisitSummary) => string) => {
    if (!body?.visit_id) return;
    const id = body.visit_id;
    setBusyVisit(id);
    try {
      const r = await client.call("visit-update", body);
      setVisits((m) => createOverride(m, id, findServerVisit(id), r.visit));
      setEdit(null);
      setFeedback(
        r.warning
          ? { kind: "warning", text: t("result.overCap", { day: formatDay(r.visit.planned_date, lang), n: r.day_count }), detail: r.warning }
          : { kind: "success", text: done(r.visit) },
      );
    } catch (e) {
      fail(e);
    } finally {
      setBusyVisit(null);
    }
  };

  const confirmEdit = () => {
    const v = edit && findServerVisit(edit.visitId);
    if (!edit || !v) return;
    if (edit.mode === "move") void update(createMoveBody(v, edit.date, edit.reason), (nv) => t("result.moved", { name: nv.account.name, day: formatDay(nv.planned_date, lang) }));
    else void update(createSkipBody(v, edit.reason), (nv) => t("result.skipped", { name: nv.account.name }));
  };

  const reorder = (day: PlanDay, v: VisitSummary, dir: -1 | 1) => {
    const body = createReorderBody(day, v, dir);
    if (body) void update(body, () => t("result.reordered"));
  };

  const accept = async () => {
    if (state.status !== "ready" || !state.data.plan_id) return;
    setAccepting(true);
    try {
      const r = await client.call("visit-plan-accept", { plan_id: state.data.plan_id });
      setStatus({ planId: r.plan_id, status: r.status });
      setFeedback({ kind: "success", text: t("accept.done") });
    } catch (e) {
      fail(e);
    } finally {
      setAccepting(false);
    }
  };

  const goWeek = (dir: -1 | 0 | 1) => {
    setEdit(null);
    if (dir === 0) setWeekStart(null);
    else if (state.status === "ready") setWeekStart(addDays(state.data.week_start, 7 * dir));
  };

  let view = state;
  if (state.status === "ready") {
    let plan: Plan = getMergedPlan(state.data, visits);
    if (status && status.planId === plan.plan_id) plan = { ...plan, status: status.status };
    view = { ...state, data: plan };
  }
  return (
    <WeekView
      state={view}
      accepting={accepting}
      edit={edit}
      busyVisit={busyVisit}
      feedback={feedback}
      onWeek={goWeek}
      onAccept={() => void accept()}
      onRetry={() => void reload(false)}
      onEdit={setEdit}
      onConfirmEdit={confirmEdit}
      onReorder={reorder}
      onDismissFeedback={() => setFeedback(null)}
    />
  );
}
