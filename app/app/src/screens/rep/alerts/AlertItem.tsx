import { Badge, Button, Card, Layout, Text } from "@wonderful/ui-base";
import type { AlertCard } from "../../../contracts";
import { useScreenI18n } from "../../../lib/i18n";
import { formatDateTime } from "../approvals/kit/format";
import messages from "./i18n";
import { getPrimaryAction, getSecondaryAction, isKnownType, SEVERITY_COLOR, type AlertAction } from "./logic";

export interface AlertItemProps {
  alert: AlertCard;
  busy?: AlertAction;
  onAct: (a: AlertCard, action: AlertAction) => void;
}

/** One alert with its suggested action as the main button (REQ-ALR-002). */
export default function AlertItem({ alert: a, busy, onAct }: AlertItemProps) {
  const { t, lang } = useScreenI18n(messages);
  const primary = getPrimaryAction(a);
  const secondary = getSecondaryAction(a);
  const open = a.status === "open";
  const account = [a.account?.name, a.account?.city].filter(Boolean).join(" · ");

  return (
    <Card withFooterDivider>
      <Card.Header
        title={account || t("general")}
        description={isKnownType(a.type) ? t(`type.${a.type}`) : t("type.other")}
        actions={
          open ? (
            <Badge text={t(`severity.${a.severity}`)} color={SEVERITY_COLOR[a.severity]} size="small" />
          ) : (
            <Badge text={t(`status.${a.status}`)} color="muted" size="small" />
          )
        }
      />
      <Card.Content>
        <Layout.Stack gap="xs">
          <Text variant="md">{a.message}</Text>
          {a.suggested_action ? (
            <Text variant="sm" weight="medium">
              {t("suggested", { action: a.suggested_action })}
            </Text>
          ) : null}
          <Text variant="sm" color="tertiary">
            {t("created", { when: formatDateTime(a.created_at, lang) })}
          </Text>
        </Layout.Stack>
      </Card.Content>
      {open ? (
        <Card.Footer>
          <Layout.Row gap="sm" wrap>
            <Button variant="primary" size="small" loading={busy === primary} disabled={!!busy} onClick={() => onAct(a, primary)}>
              {t(`act.${primary}`)}
            </Button>
            <Button size="small" loading={busy === secondary} disabled={!!busy} onClick={() => onAct(a, secondary)}>
              {t(`act.${secondary}`)}
            </Button>
            <Button variant="tertiary" size="small" loading={busy === "done"} disabled={!!busy} onClick={() => onAct(a, "done")}>
              {t("act.done")}
            </Button>
            <Button variant="tertiary" size="small" color="danger" loading={busy === "dismiss"} disabled={!!busy} onClick={() => onAct(a, "dismiss")}>
              {t("act.dismiss")}
            </Button>
          </Layout.Row>
        </Card.Footer>
      ) : null}
    </Card>
  );
}
