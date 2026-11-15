import { RobotIcon } from "@phosphor-icons/react";
import { Button, EmptyState, Icon, Layout, Page, Text, ToggleGroup } from "@wonderful/ui-base";
import type { ActionLine } from "../../../contracts";
import { screenTitleKey, useScreenI18n } from "../../../lib/i18n";
import ErrorState from "../approvals/kit/ErrorState";
import Feedback, { type FeedbackMessage } from "../approvals/kit/Feedback";
import LoadingState from "../approvals/kit/LoadingState";
import type { ResourceState } from "../approvals/kit/useResource";
import ActionItem from "./ActionItem";
import messages from "./i18n";
import type { LogFilter } from "./logic";

export interface AiLogData {
  items: ActionLine[];
  total: number;
}

export interface AiLogViewProps {
  state: ResourceState<AiLogData>;
  filter: LogFilter;
  busy: string | null;
  feedback: FeedbackMessage | null;
  onFilter: (f: LogFilter) => void;
  onRetry: () => void;
  onUndo: (a: ActionLine) => void;
  onMore: () => void;
  onOpenApprovals: () => void;
  onDismissFeedback: () => void;
}

/** The rep's AI log with undo (REQ-APP-004). */
export default function AiLogView(p: AiLogViewProps) {
  const { t } = useScreenI18n(messages);
  const data = p.state.status === "ready" ? p.state.data : null;
  return (
    <Page width="small">
      <Page.Header title={t(screenTitleKey("rep", "ai_log"))} />
      <Page.Section>
        <Layout.Stack gap="md">
          <Text variant="sm" color="secondary">
            {t("intro")}
          </Text>
          <ToggleGroup size="small" value={p.filter} onChange={(v) => p.onFilter(v as LogFilter)} aria-label={t("filter.all")}>
            <ToggleGroup.Item value="all" text={t("filter.all")} />
            <ToggleGroup.Item value="applied" text={t("filter.applied")} />
            <ToggleGroup.Item value="undone" text={t("filter.undone")} />
          </ToggleGroup>
          <Feedback message={p.feedback} onClose={p.onDismissFeedback} />
          {p.state.status === "loading" ? <LoadingState /> : null}
          {p.state.status === "error" ? <ErrorState error={p.state.error} onRetry={p.onRetry} /> : null}
          {data && !data.items.length ? <EmptyState icon={<Icon icon={RobotIcon} />} title={t("empty.title")} description={t("empty.body")} /> : null}
          {data?.items.map((a) => (
            <ActionItem key={a.ai_action_id} action={a} busy={p.busy === a.ai_action_id} onUndo={p.onUndo} onOpenApproval={p.onOpenApprovals} />
          ))}
          {data && data.items.length ? (
            <Layout.Row split>
              <Text variant="sm" color="tertiary">
                {t("shown", { shown: data.items.length, total: Math.max(data.total, data.items.length) })}
              </Text>
              {data.items.length < data.total ? (
                <Button size="small" loading={p.state.status === "ready" && p.state.refreshing} onClick={p.onMore}>
                  {t("loadMore")}
                </Button>
              ) : null}
            </Layout.Row>
          ) : null}
        </Layout.Stack>
      </Page.Section>
    </Page>
  );
}
