import { Badge, Button, Card, Layout, Text, TextArea } from "@wonderful/ui-base";
import type { ApprovalCard } from "../../../contracts";
import { useScreenI18n } from "../../../lib/i18n";
import messages from "./i18n";
import { formatDateTime } from "./kit/format";
import { canEdit, canResolve, isWaitingOnManager, STATUS_COLOR, type CallOutcome, type Decision } from "./logic";

export interface ApprovalItemProps {
  approval: ApprovalCard;
  /** The decision being sent, or "status" while approval-status runs. */
  busy?: Decision | "status";
  /** Body being edited (edit, then approve), or undefined when not editing. */
  editBody?: string;
  callOutcome?: CallOutcome;
  onResolve: (a: ApprovalCard, decision: Decision) => void;
  onEdit: (a: ApprovalCard) => void;
  onEditChange: (body: string) => void;
  onCancelEdit: () => void;
  onCheckStatus: (a: ApprovalCard) => void;
}

/** One approval: what will happen (preview), who decides, and the rep's actions. */
export default function ApprovalItem(p: ApprovalItemProps) {
  const { t, lang } = useScreenI18n(messages);
  const a = p.approval;
  const editing = p.editBody !== undefined;
  const busy = !!p.busy;
  const message = a.kind === "customer_message";
  const pct = a.kind === "discount" && a.requested_pct !== null && a.requested_pct !== undefined;

  return (
    <Card withFooterDivider>
      <Card.Header
        title={t(`kind.${a.kind}`)}
        description={a.account?.name ?? undefined}
        actions={<Badge text={t(`status.${a.status}`)} color={STATUS_COLOR[a.status]} size="small" />}
      />
      <Card.Content>
        <Layout.Stack gap="sm">
          {message && (a.recipient || a.subject) ? (
            <Layout.Stack gap="xs">
              {a.recipient ? (
                <Text variant="sm" color="secondary">
                  {t("to", { recipient: a.recipient })}
                </Text>
              ) : null}
              {a.subject ? (
                <Text variant="sm" weight="medium">
                  {t("subject", { subject: a.subject })}
                </Text>
              ) : null}
            </Layout.Stack>
          ) : null}
          {editing ? (
            <TextArea label={t("editLabel")} value={p.editBody} rows={6} autoFocus onChange={(e) => p.onEditChange(e.target.value)} />
          ) : (
            <Text variant="md">{message ? (a.body ?? a.preview) : a.preview}</Text>
          )}
          {pct ? (
            <Text variant="sm" weight="medium">
              {t("discount", { requested: a.requested_pct!, limit: a.policy_limit_pct ?? "–" })}
            </Text>
          ) : null}
          {a.approved_pct !== null && a.approved_pct !== undefined && a.status !== "pending" ? (
            <Text variant="sm" color="success">
              {t("approvedPct", { pct: a.approved_pct })}
            </Text>
          ) : null}
          {a.decision_note && a.status !== "pending" ? (
            <Text variant="sm" color="secondary">
              {t("note", { note: a.decision_note })}
            </Text>
          ) : null}
          {isWaitingOnManager(a) ? (
            <Layout.Row gap="xs" wrap>
              <Badge text={t(`mode.${a.mode}`)} color={a.mode === "live" ? "teal" : "muted"} size="small" variant="outlined" />
              {p.callOutcome ? <Badge text={t(`call.${p.callOutcome}`)} color="blue" size="small" isDot={p.callOutcome === "ringing"} /> : null}
              <Text variant="sm" color="secondary">
                {t("approver", { name: a.approver.full_name })}
              </Text>
            </Layout.Row>
          ) : null}
          <Text variant="sm" color="tertiary">
            {[
              t("created", { when: formatDateTime(a.created_at, lang) }),
              a.due_at && isWaitingOnManager(a) ? t("due", { when: formatDateTime(a.due_at, lang) }) : null,
              a.expires_at && a.status === "pending" && !isWaitingOnManager(a) ? t("expires", { when: formatDateTime(a.expires_at, lang) }) : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </Text>
        </Layout.Stack>
      </Card.Content>
      {canResolve(a) ? (
        <Card.Footer>
          {editing ? (
            <Layout.Row gap="sm" wrap>
              <Button variant="primary" loading={p.busy === "edit_approve"} disabled={busy || !p.editBody?.trim()} onClick={() => p.onResolve(a, "edit_approve")}>
                {t("saveApprove")}
              </Button>
              <Button variant="tertiary" disabled={busy} onClick={p.onCancelEdit}>
                {t("cancel")}
              </Button>
            </Layout.Row>
          ) : (
            <Layout.Row gap="sm" wrap>
              <Button variant="primary" loading={p.busy === "approve"} disabled={busy} onClick={() => p.onResolve(a, "approve")}>
                {a.status === "failed" ? t("retry") : message ? t("approve") : t("approveConversion")}
              </Button>
              {canEdit(a) ? (
                <Button disabled={busy} onClick={() => p.onEdit(a)}>
                  {t("edit")}
                </Button>
              ) : null}
              <Button variant="tertiary" color="danger" loading={p.busy === "reject"} disabled={busy} onClick={() => p.onResolve(a, "reject")}>
                {t("reject")}
              </Button>
            </Layout.Row>
          )}
        </Card.Footer>
      ) : isWaitingOnManager(a) ? (
        <Card.Footer>
          <Button size="small" loading={p.busy === "status"} onClick={() => p.onCheckStatus(a)}>
            {t("checkStatus")}
          </Button>
        </Card.Footer>
      ) : null}
    </Card>
  );
}
