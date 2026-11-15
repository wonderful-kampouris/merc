import { useState } from "react";
import type { AlertCard } from "../../../contracts";
import { useScreenI18n } from "../../../lib/i18n";
import type { ScreenProps } from "../../../lib/screenRegistry";
import { useLive } from "../../../lib/useLive";
import { getErrorDetail, getErrorKey } from "../approvals/kit/errorKey";
import type { FeedbackMessage } from "../approvals/kit/Feedback";
import { useOverrides } from "../approvals/kit/useOverrides";
import { useResource } from "../approvals/kit/useResource";
import AlertsView from "./AlertsView";
import messages from "./i18n";
import { getAlertId, listRequest, type AlertAction, type AlertFilter } from "./logic";

/** /rep/alerts: alerts-list, alert-act; live alert.created. */
export default function Alerts({ screen, client, openLiveSocket, navigate }: ScreenProps) {
  const { t } = useScreenI18n(messages);
  const [filter, setFilter] = useState<AlertFilter>("open");
  const [busy, setBusy] = useState<Record<string, AlertAction>>({});
  const [feedback, setFeedback] = useState<(FeedbackMessage & { approvals?: boolean }) | null>(null);
  const { state, reload } = useResource(async () => (await client.call("alerts-list", listRequest(filter))).items, `alerts:${filter}`);
  const overrides = useOverrides<AlertCard>(getAlertId);

  const live = useLive({
    types: screen.events,
    openSocket: openLiveSocket,
    poll: () => reload(),
    onEvent: (e) => {
      if (e.type !== "alert.created") return;
      const alert = (e.payload as { alert: AlertCard }).alert;
      setFeedback({ kind: "info", text: t("newAlert", { message: alert.message }) });
      void reload();
    },
  });

  const act = async (a: AlertCard, action: AlertAction) => {
    setBusy((b) => ({ ...b, [a.alert_id]: action }));
    try {
      const r = await client.call("alert-act", { alert_id: a.alert_id, action });
      const server = state.status === "ready" ? state.data.find((x) => x.alert_id === a.alert_id) : undefined;
      // create_task / create_draft keep the alert open; done / dismiss close it. The row keeps its id on screen.
      const status = action === "done" ? "done" : action === "dismiss" ? "dismissed" : r.alert.status;
      overrides.record(a.alert_id, server, { ...r.alert, alert_id: a.alert_id, status });
      setFeedback({
        kind: "success",
        text: t(`result.${action}`, { account: a.account?.name ?? t("general") }),
        approvals: action === "create_draft" && !!r.approval_id,
      });
    } catch (e) {
      setFeedback({ kind: "error", text: `${t("actionFailed")}. ${t(getErrorKey(e))}`, detail: getErrorDetail(e) });
    } finally {
      setBusy((b) => {
        const next = { ...b };
        delete next[a.alert_id];
        return next;
      });
    }
  };

  const view = state.status === "ready" ? { ...state, data: overrides.merge(state.data) } : state;
  return (
    <AlertsView
      state={view}
      filter={filter}
      live={live}
      busy={busy}
      feedback={feedback}
      onFilter={setFilter}
      onRetry={() => void reload(false)}
      onAct={(a, action) => void act(a, action)}
      onOpenApprovals={() => navigate("/rep/approvals")}
      onDismissFeedback={() => setFeedback(null)}
    />
  );
}
