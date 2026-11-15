import { BellSimpleIcon } from "@phosphor-icons/react";
import { Badge, Button, EmptyState, Icon, Layout, Page, Text, ToggleGroup } from "@wonderful/ui-base";
import type { AlertCard } from "../../../contracts";
import { screenTitleKey, useScreenI18n } from "../../../lib/i18n";
import type { LiveMode } from "../../../lib/live";
import ErrorState from "../approvals/kit/ErrorState";
import Feedback, { type FeedbackMessage } from "../approvals/kit/Feedback";
import LoadingState from "../approvals/kit/LoadingState";
import type { ResourceState } from "../approvals/kit/useResource";
import AlertItem from "./AlertItem";
import messages from "./i18n";
import { getVisible, type AlertAction, type AlertFilter } from "./logic";

export interface AlertsViewProps {
  state: ResourceState<AlertCard[]>;
  filter: AlertFilter;
  live: LiveMode | null;
  busy: Readonly<Record<string, AlertAction>>;
  feedback: (FeedbackMessage & { approvals?: boolean }) | null;
  onFilter: (f: AlertFilter) => void;
  onRetry: () => void;
  onAct: (a: AlertCard, action: AlertAction) => void;
  onOpenApprovals: () => void;
  onDismissFeedback: () => void;
}

const LIVE_LABEL = { connecting: "live.connecting", socket: "live.socket", polling: "live.polling" } as const;

/** Rep alerts: each with a suggested action that drafts a message or creates a task (REQ-ALR-002). */
export default function AlertsView(p: AlertsViewProps) {
  const { t } = useScreenI18n(messages);
  const items = p.state.status === "ready" ? getVisible(p.state.data, p.filter) : [];
  const openCount = p.state.status === "ready" ? p.state.data.filter((a) => a.status === "open").length : 0;

  return (
    <Page width="small">
      <Page.Header
        title={t(screenTitleKey("rep", "alerts"))}
        actions={
          <Layout.Row gap="xs" wrap>
            {openCount ? <Badge text={t("count", { n: openCount })} color="red" size="small" /> : null}
            {p.live ? <Badge text={t(LIVE_LABEL[p.live])} color={p.live === "socket" ? "green" : "muted"} isDot={p.live === "socket"} size="small" /> : null}
          </Layout.Row>
        }
      />
      <Page.Section>
        <Layout.Stack gap="md">
          <Text variant="sm" color="secondary">
            {t("intro")}
          </Text>
          <ToggleGroup size="small" value={p.filter} onChange={(v) => p.onFilter(v as AlertFilter)} aria-label={t("filter.open")}>
            <ToggleGroup.Item value="open" text={t("filter.open")} />
            <ToggleGroup.Item value="all" text={t("filter.all")} />
          </ToggleGroup>
          <Feedback
            message={p.feedback}
            onClose={p.onDismissFeedback}
            action={
              p.feedback?.approvals ? (
                <Button size="small" onClick={p.onOpenApprovals}>
                  {t("openApprovals")}
                </Button>
              ) : undefined
            }
          />
          {p.state.status === "loading" ? <LoadingState /> : null}
          {p.state.status === "error" ? <ErrorState error={p.state.error} onRetry={p.onRetry} /> : null}
          {p.state.status === "ready" && !items.length ? (
            <EmptyState
              icon={<Icon icon={BellSimpleIcon} />}
              title={p.filter === "open" ? t("empty.title") : t("emptyAll.title")}
              description={t("empty.body")}
            />
          ) : null}
          {items.map((a) => (
            <AlertItem key={a.alert_id} alert={a} busy={p.busy[a.alert_id]} onAct={p.onAct} />
          ))}
        </Layout.Stack>
      </Page.Section>
    </Page>
  );
}
