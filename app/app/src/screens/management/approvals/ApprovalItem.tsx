import { Badge, Button, Card, InputNumber, InputText, Layout, Notice, Text } from "@wonderful/ui-base";
import { useState } from "react";
import type { ApprovalCard } from "../../../contracts";
import type { Lang } from "../../../lib/i18n";
import { canCounter, dueState, isOpen, minutesLeft, pct, suggestedCounter, validateCounter, type Decision } from "./logic";

type T = (key: string, vars?: Record<string, string | number>) => string;
type BadgeColor = "neutral" | "muted" | "blue" | "green" | "orange" | "red" | "teal" | "purple";

const STATUS_COLOR: Record<ApprovalCard["status"], BadgeColor> = {
  pending: "blue",
  escalated: "orange",
  approved: "green",
  sent: "green",
  countered: "teal",
  rejected: "red",
  failed: "red",
  expired: "muted",
};

export interface ApprovalItemProps {
  card: ApprovalCard;
  lang: Lang;
  t: T;
  busy?: boolean;
  /** Message after a saved decision. */
  result?: string;
  /** Message after a failed decision. */
  error?: string;
  now?: Date;
  onDecide: (decision: Decision, opts: { pct?: number | null; note?: string | null }) => void;
}

/** One approval request with one-tap Approve / Reject and an inline counter-offer (REQ-DSC-009). */
export default function ApprovalItem({ card, lang, t, busy, result, error, now, onDecide }: ApprovalItemProps) {
  const [countering, setCountering] = useState(false);
  const [counterPct, setCounterPct] = useState<number | null>(() => suggestedCounter(card));
  const [note, setNote] = useState("");
  const open = isOpen(card);
  const due = dueState(card, now);
  const problem = countering ? validateCounter(counterPct, card) : null;
  const title = card.account?.name ?? t(`kind_${card.kind}`);
  const isDiscount = card.kind === "discount";

  return (
    <Card withFooterDivider={open}>
      <Card.Header
        title={title}
        description={t("from", { name: card.requested_by.full_name })}
        actions={<Badge text={t(`status_${card.status}`)} color={STATUS_COLOR[card.status]} size="small" />}
      />
      <Card.Content>
        <Layout.Stack gap="sm">
          <Layout.Row gap="xs" wrap>
            <Badge text={t(`kind_${card.kind}`)} variant="outlined" size="small" />
            {open && card.mode === "live" ? <Badge text={t("mode_live")} color="purple" isDot size="small" /> : null}
            {due === "overdue" && card.due_at ? (
              <Badge text={t("due_overdue", { n: Math.abs(minutesLeft(card.due_at, now)) })} color="red" size="small" />
            ) : null}
            {due === "soon" && card.due_at ? <Badge text={t("due_in", { n: minutesLeft(card.due_at, now) })} color="orange" size="small" /> : null}
          </Layout.Row>
          {isDiscount ? (
            <Layout.Row gap="lg" wrap>
              <Layout.Stack gap="none">
                <Text variant="sm" color="secondary">{t("requested")}</Text>
                <Text variant="h2">{pct(card.requested_pct, lang)}</Text>
              </Layout.Stack>
              <Layout.Stack gap="none">
                <Text variant="sm" color="secondary">{t("rep_limit")}</Text>
                <Text variant="h2" color="secondary">{pct(card.policy_limit_pct, lang)}</Text>
              </Layout.Stack>
              {!open && typeof card.approved_pct === "number" ? (
                <Layout.Stack gap="none">
                  <Text variant="sm" color="secondary">{t("approved_pct")}</Text>
                  <Text variant="h2" color="success">{pct(card.approved_pct, lang)}</Text>
                </Layout.Stack>
              ) : null}
            </Layout.Row>
          ) : null}
          <Text variant="md">{card.preview}</Text>
          {card.kind === "customer_message" && (card.subject || card.recipient) ? (
            <Layout.Stack gap="xs">
              {card.recipient ? <Text variant="sm" color="secondary">{t("recipient")}: {card.recipient}</Text> : null}
              {card.subject ? <Text variant="sm" color="secondary">{t("subject")}: {card.subject}</Text> : null}
              {card.body ? <Text variant="sm" lineClamp={4}>{card.body}</Text> : null}
            </Layout.Stack>
          ) : null}
          {card.decision_note && !open ? <Text variant="sm" color="secondary">“{card.decision_note}”</Text> : null}
          {countering && open ? (
            <Layout.Stack gap="sm">
              <InputNumber
                label={t("counter_label")}
                hint={problem ? undefined : t("counter_hint", { pct: pct(card.requested_pct, lang) })}
                isError={!!problem}
                value={counterPct}
                min={0}
                step={0.5}
                suffix="%"
                controls
                onChange={setCounterPct}
              />
              {problem ? (
                <Text variant="sm" color="danger">{t(`err_${problem}`, { pct: pct(card.requested_pct, lang) })}</Text>
              ) : null}
              <InputText label={t("note_label")} value={note} onChange={(e) => setNote(e.target.value)} maxLength={280} />
            </Layout.Stack>
          ) : null}
          {result ? <Notice variant="info" size="compact" description={result} /> : null}
          {error ? <Notice variant="warning" size="compact" description={error} /> : null}
        </Layout.Stack>
      </Card.Content>
      {open ? (
        <Card.Footer>
          {countering ? (
            <Layout.Row gap="sm" className="w-full">
              <Button variant="tertiary" size="large" onClick={() => setCountering(false)} disabled={busy}>
                {t("cancel")}
              </Button>
              <Button
                variant="primary"
                size="large"
                className="flex-1"
                loading={busy}
                disabled={!!problem}
                onClick={() => onDecide("counter", { pct: counterPct, note })}
              >
                {t("send_counter", { pct: pct(counterPct, lang) })}
              </Button>
            </Layout.Row>
          ) : (
            <Layout.Row gap="sm" className="w-full">
              <Button variant="tertiary" color="danger" size="large" disabled={busy} onClick={() => onDecide("reject", {})}>
                {t("reject")}
              </Button>
              {canCounter(card) ? (
                <Button size="large" disabled={busy} onClick={() => setCountering(true)}>
                  {t("counter")}
                </Button>
              ) : null}
              <Button variant="primary" size="large" className="flex-1" loading={busy} onClick={() => onDecide("approve", {})}>
                {isDiscount ? t("approve_pct", { pct: pct(card.requested_pct, lang) }) : t("approve")}
              </Button>
            </Layout.Row>
          )}
        </Card.Footer>
      ) : null}
    </Card>
  );
}
