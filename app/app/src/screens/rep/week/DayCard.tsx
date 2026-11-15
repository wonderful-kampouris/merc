import { ArrowDownIcon, ArrowUpIcon } from "@phosphor-icons/react";
import { Badge, Button, Card, Icon, Layout, Text } from "@wonderful/ui-base";
import type { VisitSummary } from "../../../contracts";
import { useScreenI18n } from "../../../lib/i18n";
import { formatDay } from "../approvals/kit/format";
import messages from "./i18n";
import { canChange, isKnownPurpose, type EditState, type PlanDay } from "./logic";
import VisitEditor from "./VisitEditor";

export interface DayCardProps {
  day: PlanDay;
  weekDays: readonly string[];
  edit: EditState | null;
  busyVisit: string | null;
  onEdit: (e: EditState | null) => void;
  onConfirmEdit: () => void;
  onReorder: (day: PlanDay, v: VisitSummary, dir: -1 | 1) => void;
}

/** One day of the week plan: the visits in route order with move / skip / reorder. */
export default function DayCard(p: DayCardProps) {
  const { t, lang } = useScreenI18n(messages);
  const active = p.day.visits.filter((v) => v.status !== "skipped").length;
  const editing = p.edit && p.day.visits.some((v) => v.visit_id === p.edit!.visitId) ? p.edit : null;

  return (
    <Card withHeaderDivider>
      <Card.Header title={formatDay(p.day.date, lang)} description={active ? t("day.count", { n: active }) : t("day.empty")} />
      {p.day.visits.length ? (
        <Card.List>
          {p.day.visits.map((v, i) => {
            const open = canChange(v);
            const busy = p.busyVisit === v.visit_id;
            const purpose = v.purpose ? (isKnownPurpose(v.purpose) ? t(`purpose.${v.purpose}`) : v.purpose) : null;
            return (
              <Card.Meta
                key={`${v.visit_id}-${i}`}
                avatar={<Badge text={String(i + 1)} size="small" color={open ? "blue" : "muted"} />}
                title={v.account.name}
                description={[purpose, v.account.city, v.reason].filter(Boolean).join(" · ") || undefined}
                actions={
                  open ? (
                    <Layout.Row gap="xs">
                      <Button size="inline" variant="tertiary" aria-label={t("visit.up")} prefix={<Icon icon={ArrowUpIcon} />} disabled={busy || i === 0} onClick={() => p.onReorder(p.day, v, -1)} />
                      <Button size="inline" variant="tertiary" aria-label={t("visit.down")} prefix={<Icon icon={ArrowDownIcon} />} disabled={busy || i === p.day.visits.length - 1} onClick={() => p.onReorder(p.day, v, 1)} />
                      <Button size="inline" disabled={busy} onClick={() => p.onEdit({ visitId: v.visit_id, mode: "move", date: p.day.date, reason: "" })}>
                        {t("visit.move")}
                      </Button>
                      <Button size="inline" variant="tertiary" color="danger" disabled={busy} onClick={() => p.onEdit({ visitId: v.visit_id, mode: "skip", date: p.day.date, reason: "" })}>
                        {t("visit.skip")}
                      </Button>
                    </Layout.Row>
                  ) : (
                    <Badge text={t(v.status === "done" ? "visitStatus.done" : "visitStatus.skipped")} size="small" color={v.status === "done" ? "green" : "muted"} />
                  )
                }
              />
            );
          })}
        </Card.List>
      ) : (
        <Card.Content>
          <Text variant="sm" color="tertiary">
            {t("day.empty")}
          </Text>
        </Card.Content>
      )}
      {editing ? (
        <VisitEditor edit={editing} days={p.weekDays} busy={p.busyVisit === editing.visitId} onChange={(e) => p.onEdit(e)} onConfirm={p.onConfirmEdit} onCancel={() => p.onEdit(null)} />
      ) : null}
    </Card>
  );
}
