import { useCallback, useState } from "react";
import type { ApprovalCard } from "../../../contracts";
import { useScreenI18n } from "../../../lib/i18n";
import type { ScreenProps } from "../../../lib/screenRegistry";
import { useLive } from "../../../lib/useLive";
import ApprovalsView from "./ApprovalsView";
import messages from "./i18n";
import { getErrorDetail, getErrorKey } from "./kit/errorKey";
import type { FeedbackMessage } from "./kit/Feedback";
import { useOverrides } from "./kit/useOverrides";
import { useResource } from "./kit/useResource";
import { createResolveBody, getApprovalId, getEditBody, getLiveChange, getResult, type ApprovalFilter, type CallOutcome, type Decision } from "./logic";

/** /rep/approvals: approvals-list, approval-resolve, approval-status; live approval.* and manager_call.status. */
export default function Approvals({ screen, client, openLiveSocket }: ScreenProps) {
  const { t } = useScreenI18n(messages);
  const [filter, setFilter] = useState<ApprovalFilter>("open");
  const [busy, setBusy] = useState<Record<string, Decision | "status">>({});
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(null);
  const [calls, setCalls] = useState<Record<string, CallOutcome>>({});
  const [feedback, setFeedback] = useState<FeedbackMessage | null>(null);
  const { state, reload } = useResource(async () => (await client.call("approvals-list", {})).items, "approvals");
  const overrides = useOverrides<ApprovalCard>(getApprovalId);

  const serverRow = (id: string) => (state.status === "ready" ? state.data.find((a) => a.approval_id === id) : undefined);
  /** Keep the server's answer for the row the rep acted on (keyed by that row's id). */
  const keep = (id: string, a: ApprovalCard) => overrides.record(id, serverRow(id), { ...a, approval_id: id });
  const setBusyFor = (id: string, v?: Decision | "status") =>
    setBusy((b) => {
      const next = { ...b };
      if (v) next[id] = v;
      else delete next[id];
      return next;
    });
  const tell = (a: ApprovalCard) => {
    const r = getResult(a);
    setFeedback({ kind: r.kind, text: t(r.key, { recipient: a.recipient ?? a.account?.name ?? t("someone"), status: t(`status.${a.status}`) }) });
  };
  const fail = (e: unknown) => setFeedback({ kind: "error", text: `${t("actionFailed")}. ${t(getErrorKey(e))}`, detail: getErrorDetail(e) });

  const live = useLive({
    types: screen.events,
    openSocket: openLiveSocket,
    poll: () => reload(),
    onEvent: useCallback(
      (e: Parameters<NonNullable<Parameters<typeof useLive>[0]["onEvent"]>>[0]) => {
        const c = getLiveChange(e);
        if (c?.type === "call") setCalls((m) => ({ ...m, [c.approvalId]: c.outcome }));
        if (c?.type === "approval") void reload();
      },
      [reload],
    ),
  });

  const resolve = async (a: ApprovalCard, decision: Decision) => {
    setBusyFor(a.approval_id, decision);
    try {
      const body = createResolveBody(a, decision, editing?.id === a.approval_id ? editing.body : undefined);
      const r = await client.call("approval-resolve", body);
      keep(a.approval_id, r.approval);
      tell(r.approval);
      setEditing(null);
    } catch (e) {
      fail(e);
    } finally {
      setBusyFor(a.approval_id);
    }
  };

  const checkStatus = async (a: ApprovalCard) => {
    setBusyFor(a.approval_id, "status");
    try {
      const r = await client.call("approval-status", { approval_id: a.approval_id });
      keep(a.approval_id, r.approval);
      tell(r.approval);
    } catch (e) {
      fail(e);
    } finally {
      setBusyFor(a.approval_id);
    }
  };

  const view = state.status === "ready" ? { ...state, data: overrides.merge(state.data) } : state;
  return (
    <ApprovalsView
      state={view}
      filter={filter}
      live={live}
      busy={busy}
      editing={editing}
      calls={calls}
      feedback={feedback}
      onFilter={setFilter}
      onRetry={() => void reload(false)}
      onResolve={(a, d) => void resolve(a, d)}
      onEdit={(a) => setEditing({ id: a.approval_id, body: getEditBody(a) })}
      onEditChange={(body) => setEditing((ed) => (ed ? { ...ed, body } : ed))}
      onCancelEdit={() => setEditing(null)}
      onCheckStatus={(a) => void checkStatus(a)}
      onDismissFeedback={() => setFeedback(null)}
    />
  );
}
