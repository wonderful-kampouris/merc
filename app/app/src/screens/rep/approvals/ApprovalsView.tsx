import { CheckSquareIcon } from "@phosphor-icons/react";
import { Badge, EmptyState, Icon, Layout, Page, Text, ToggleGroup } from "@wonderful/ui-base";
import type { ApprovalCard } from "../../../contracts";
import { screenTitleKey, useScreenI18n } from "../../../lib/i18n";
import type { LiveMode } from "../../../lib/live";
import ApprovalItem from "./ApprovalItem";
import messages from "./i18n";
import ErrorState from "./kit/ErrorState";
import Feedback, { type FeedbackMessage } from "./kit/Feedback";
import LoadingState from "./kit/LoadingState";
import type { ResourceState } from "./kit/useResource";
import { getVisible, isOpen, type ApprovalFilter, type CallOutcome, type Decision } from "./logic";

export interface ApprovalsViewProps {
  state: ResourceState<ApprovalCard[]>;
  filter: ApprovalFilter;
  live: LiveMode | null;
  busy: Readonly<Record<string, Decision | "status">>;
  editing: { id: string; body: string } | null;
  calls: Readonly<Record<string, CallOutcome>>;
  feedback: FeedbackMessage | null;
  onFilter: (f: ApprovalFilter) => void;
  onRetry: () => void;
  onResolve: (a: ApprovalCard, d: Decision) => void;
  onEdit: (a: ApprovalCard) => void;
  onEditChange: (body: string) => void;
  onCancelEdit: () => void;
  onCheckStatus: (a: ApprovalCard) => void;
  onDismissFeedback: () => void;
}

const LIVE_LABEL = { connecting: "live.connecting", socket: "live.socket", polling: "live.polling" } as const;

/** Rep approvals (REQ-APR-001): approve, edit then approve, or reject; follow discount requests. */
export default function ApprovalsView(p: ApprovalsViewProps) {
  const { t } = useScreenI18n(messages);
  const items = p.state.status === "ready" ? getVisible(p.state.data, p.filter) : [];
  const openCount = p.state.status === "ready" ? p.state.data.filter(isOpen).length : 0;

  return (
    <Page width="small">
      <Page.Header
        title={t(screenTitleKey("rep", "approvals"))}
        actions={
          <Layout.Row gap="xs" wrap>
            {openCount ? <Badge text={t("count", { n: openCount })} color="orange" size="small" /> : null}
            {p.live ? <Badge text={t(LIVE_LABEL[p.live])} color={p.live === "socket" ? "green" : "muted"} isDot={p.live === "socket"} size="small" /> : null}
          </Layout.Row>
        }
      />
      <Page.Section>
        <Layout.Stack gap="md">
          <Text variant="sm" color="secondary">
            {t("intro")}
          </Text>
          <ToggleGroup size="small" value={p.filter} onChange={(v) => p.onFilter(v as ApprovalFilter)} aria-label={t("filter.open")}>
            <ToggleGroup.Item value="open" text={t("filter.open")} />
            <ToggleGroup.Item value="all" text={t("filter.all")} />
          </ToggleGroup>
          <Feedback message={p.feedback} onClose={p.onDismissFeedback} />
          {p.state.status === "loading" ? <LoadingState /> : null}
          {p.state.status === "error" ? <ErrorState error={p.state.error} onRetry={p.onRetry} /> : null}
          {p.state.status === "ready" && !items.length ? (
            <EmptyState
              icon={<Icon icon={CheckSquareIcon} />}
              title={p.filter === "open" ? t("empty.title") : t("emptyAll.title")}
              description={t("empty.body")}
            />
          ) : null}
          {items.map((a) => (
            <ApprovalItem
              key={a.approval_id}
              approval={a}
              busy={p.busy[a.approval_id]}
              editBody={p.editing?.id === a.approval_id ? p.editing.body : undefined}
              callOutcome={p.calls[a.approval_id]}
              onResolve={p.onResolve}
              onEdit={p.onEdit}
              onEditChange={p.onEditChange}
              onCancelEdit={p.onCancelEdit}
              onCheckStatus={p.onCheckStatus}
            />
          ))}
        </Layout.Stack>
      </Page.Section>
    </Page>
  );
}
