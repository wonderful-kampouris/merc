import { useState } from "react";
import type { ActionLine } from "../../../contracts";
import { useScreenI18n } from "../../../lib/i18n";
import type { ScreenProps } from "../../../lib/screenRegistry";
import { getErrorDetail, getErrorKey } from "../approvals/kit/errorKey";
import type { FeedbackMessage } from "../approvals/kit/Feedback";
import { useOverrides } from "../approvals/kit/useOverrides";
import { useResource } from "../approvals/kit/useResource";
import AiLogView, { type AiLogData } from "./AiLogView";
import messages from "./i18n";
import { getActionId, getUndone, listRequest, PAGE_SIZE, type LogFilter } from "./logic";

/** /rep/ai-log: ai-actions-list, ai-action-undo. */
export default function AiLog({ client, navigate }: ScreenProps) {
  const { t } = useScreenI18n(messages);
  const [filter, setFilter] = useState<LogFilter>("all");
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<FeedbackMessage | null>(null);
  const { state, reload } = useResource<AiLogData>(async () => {
    const r = await client.call("ai-actions-list", listRequest(filter, limit));
    return { items: r.items, total: r.page.total };
  }, `ai:${filter}:${limit}`);
  const overrides = useOverrides<ActionLine>(getActionId);

  const undo = async (a: ActionLine) => {
    setBusy(a.ai_action_id);
    try {
      const r = await client.call("ai-action-undo", { ai_action_id: a.ai_action_id });
      const server = state.status === "ready" ? state.data.items.find((x) => x.ai_action_id === a.ai_action_id) : undefined;
      overrides.record(a.ai_action_id, server, { ...getUndone(a), status: r.status });
      setFeedback({ kind: "success", text: t("result.undone", { summary: a.summary }) });
    } catch (e) {
      setFeedback({ kind: "error", text: `${t("actionFailed")}. ${t(getErrorKey(e))}`, detail: getErrorDetail(e) });
    } finally {
      setBusy(null);
    }
  };

  const view = state.status === "ready" ? { ...state, data: { ...state.data, items: overrides.merge(state.data.items) } } : state;
  return (
    <AiLogView
      state={view}
      filter={filter}
      busy={busy}
      feedback={feedback}
      onFilter={(f) => {
        setFilter(f);
        setLimit(PAGE_SIZE);
      }}
      onRetry={() => void reload(false)}
      onUndo={(a) => void undo(a)}
      onMore={() => setLimit((l) => l + PAGE_SIZE)}
      onOpenApprovals={() => navigate("/rep/approvals")}
      onDismissFeedback={() => setFeedback(null)}
    />
  );
}
