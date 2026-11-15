import { CalendarBlankIcon, CaretLeftIcon, CaretRightIcon, CheckIcon } from "@phosphor-icons/react";
import { Badge, Button, Card, EmptyState, Icon, Layout, Page, Text } from "@wonderful/ui-base";
import type { VisitSummary } from "../../../contracts";
import { screenTitleKey, useScreenI18n } from "../../../lib/i18n";
import ErrorState from "../approvals/kit/ErrorState";
import Feedback, { type FeedbackMessage } from "../approvals/kit/Feedback";
import { formatDay } from "../approvals/kit/format";
import LoadingState from "../approvals/kit/LoadingState";
import type { ResourceState } from "../approvals/kit/useResource";
import DayCard from "./DayCard";
import messages from "./i18n";
import { canAccept, countVisits, isKnownPlanStatus, PLAN_COLOR, type EditState, type Plan, type PlanDay } from "./logic";

export interface WeekViewProps {
  state: ResourceState<Plan>;
  accepting: boolean;
  edit: EditState | null;
  busyVisit: string | null;
  feedback: FeedbackMessage | null;
  onWeek: (dir: -1 | 0 | 1) => void;
  onAccept: () => void;
  onRetry: () => void;
  onEdit: (e: EditState | null) => void;
  onConfirmEdit: () => void;
  onReorder: (day: PlanDay, v: VisitSummary, dir: -1 | 1) => void;
  onDismissFeedback: () => void;
}

/** The rep's week plan: accept it, or move / skip / reorder visits first (REQ-PLN-002, REQ-PLN-003). */
export default function WeekView(p: WeekViewProps) {
  const { t, lang } = useScreenI18n(messages);
  const plan = p.state.status === "ready" ? p.state.data : null;
  const total = plan ? plan.days.reduce((n, d) => n + d.visits.length, 0) : 0;

  return (
    <Page width="small">
      <Page.Header
        title={t(screenTitleKey("rep", "week"))}
        actions={
          plan && isKnownPlanStatus(plan.status) ? <Badge text={t(`status.${plan.status}`)} color={PLAN_COLOR[plan.status]} size="small" /> : null
        }
      />
      <Page.Section>
        <Layout.Stack gap="md">
          <Layout.Row split gap="xs">
            <Text variant="sm" color="secondary">
              {plan ? t("weekOf", { date: formatDay(plan.week_start, lang), n: countVisits(plan) }) : ""}
            </Text>
            <Layout.Row gap="xs">
              <Button size="small" variant="tertiary" aria-label={t("nav.prev")} prefix={<Icon icon={CaretLeftIcon} />} onClick={() => p.onWeek(-1)} />
              <Button size="small" variant="tertiary" onClick={() => p.onWeek(0)}>
                {t("nav.current")}
              </Button>
              <Button size="small" variant="tertiary" aria-label={t("nav.next")} prefix={<Icon icon={CaretRightIcon} />} onClick={() => p.onWeek(1)} />
            </Layout.Row>
          </Layout.Row>
          <Feedback message={p.feedback} onClose={p.onDismissFeedback} />
          {p.state.status === "loading" ? <LoadingState rows={4} /> : null}
          {p.state.status === "error" ? <ErrorState error={p.state.error} onRetry={p.onRetry} /> : null}
          {plan && !total ? <EmptyState icon={<Icon icon={CalendarBlankIcon} />} title={t("empty.title")} description={t("empty.body")} /> : null}
          {plan && total && canAccept(plan) ? (
            <Card>
              <Card.Header title={t("accept.title")} description={t("accept.body")} />
              <Card.Footer>
                <Button variant="primary" prefix={<Icon icon={CheckIcon} />} loading={p.accepting} onClick={p.onAccept}>
                  {t("accept.go")}
                </Button>
              </Card.Footer>
            </Card>
          ) : null}
          {plan && total && plan.status === "accepted" ? (
            <Text variant="sm" color="secondary">
              {t("accepted.body")}
            </Text>
          ) : null}
          {plan && total
            ? plan.days.map((d) => (
                <DayCard
                  key={d.date}
                  day={d}
                  weekDays={plan.days.map((x) => x.date)}
                  edit={p.edit}
                  busyVisit={p.busyVisit}
                  onEdit={p.onEdit}
                  onConfirmEdit={p.onConfirmEdit}
                  onReorder={p.onReorder}
                />
              ))
            : null}
        </Layout.Stack>
      </Page.Section>
    </Page>
  );
}
