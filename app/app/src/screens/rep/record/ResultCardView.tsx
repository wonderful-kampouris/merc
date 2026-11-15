import { Alert, Badge, Button, Card, Layout, Text } from "@wonderful/ui-base";
import messages from "./i18n";
import { useScreenI18n } from "../../../lib/i18n";
import { canUndo, cardCounts, seconds, sortLines, STATUS_COLOR, type ResultCard } from "./resultCard";

export interface ResultCardViewProps {
  card: ResultCard;
  /** ai_action_id currently being undone */
  undoing?: string | null;
  undoError?: string | null;
  onUndo?: (aiActionId: string) => void;
  onClose?: () => void;
}

/** The debrief result card (REQ-DEB-003): actions with undo, missing-field questions, pending approvals, spoken summary. */
export default function ResultCardView({ card, undoing, undoError, onUndo, onClose }: ResultCardViewProps) {
  const { t } = useScreenI18n(messages);
  const counts = cardCounts(card);
  const lines = sortLines(card.lines);
  return (
    <Card data-testid="result-card">
      <Card.Header
        title={`${t("card.title")} · ${card.account.name}`}
        description={`${t("card.counts", counts)} · ${t("card.ready", { s: seconds(card.processing_ms) })}`}
        actions={onClose ? <Button variant="tertiary" size="small" onClick={onClose}>{t("card.close")}</Button> : undefined}
      />
      <Card.Content>
        <Layout.Stack gap="lg">
          <Layout.Stack gap="xs">
            <Text variant="label-sm" color="secondary">{t("card.summary")}</Text>
            <Text variant="body">{card.spoken_summary}</Text>
          </Layout.Stack>
          {undoError ? <Alert variant="error" size="compact" description={t("card.undoFailed", { msg: undoError })} /> : null}
          <Layout.Stack gap="xs">
            <Text variant="label-sm" color="secondary">{t("card.actions")}</Text>
            {lines.length === 0 ? (
              <Text variant="body-sm" color="secondary">{t("card.noActions")}</Text>
            ) : (
              <Card variant="secondary">
                <Card.List>
                  {lines.map((l) => (
                    <Card.Meta
                      key={l.ai_action_id}
                      title={<Badge text={t(`line.${l.status}`)} color={STATUS_COLOR[l.status]} size="small" />}
                      description={
                        // The summary goes in the description so it wraps instead of truncating next to the Undo button.
                        <Layout.Stack gap="xs">
                          <Text variant="body-sm" color={l.status === "undone" ? "tertiary" : "default"}>{l.summary}</Text>
                          <Layout.Row gap="xs" wrap>
                            <Badge text={l.action_type} variant="outlined" size="small" />
                          </Layout.Row>
                        </Layout.Stack>
                      }
                      actions={
                        canUndo(l) && onUndo ? (
                          <Button
                            variant="secondary"
                            size="small"
                            loading={undoing === l.ai_action_id}
                            disabled={!!undoing}
                            onClick={() => onUndo(l.ai_action_id)}
                            aria-label={`${t("card.undo")}: ${l.summary}`}
                          >
                            {undoing === l.ai_action_id ? t("card.undoing") : t("card.undo")}
                          </Button>
                        ) : l.status === "undone" ? (
                          <Text variant="caption" color="tertiary">{t("card.undone")}</Text>
                        ) : undefined
                      }
                    />
                  ))}
                </Card.List>
              </Card>
            )}
          </Layout.Stack>
          {card.missing_fields.length ? (
            <Layout.Stack gap="xs">
              <Text variant="label-sm" color="secondary">{t("card.questions")}</Text>
              {card.missing_fields.map((m) => (
                <Alert key={m.field} variant="warning" size="compact" title={m.question} />
              ))}
            </Layout.Stack>
          ) : null}
          {card.pending_approvals.length ? (
            <Layout.Stack gap="xs">
              <Text variant="label-sm" color="secondary">{t("card.approvals")}</Text>
              <Card variant="secondary">
                <Card.List>
                  {card.pending_approvals.map((a) => (
                    <Card.Meta
                      key={a.approval_id}
                      title={t(`approval.${a.kind}`)}
                      description={a.preview}
                      actions={<Badge text={a.approver.full_name} color="orange" size="small" />}
                    />
                  ))}
                </Card.List>
              </Card>
            </Layout.Stack>
          ) : null}
        </Layout.Stack>
      </Card.Content>
    </Card>
  );
}
