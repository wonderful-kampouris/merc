import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react";
import { Badge, Button, Card, Icon, Layout } from "@wonderful/ui-base";
import type { ActionLine } from "../../../contracts";
import { useScreenI18n } from "../../../lib/i18n";
import messages from "./i18n";
import { canUndo, CLASS_COLOR, humanize, STATUS_COLOR } from "./logic";

export interface ActionItemProps {
  action: ActionLine;
  busy: boolean;
  onUndo: (a: ActionLine) => void;
  onOpenApproval: () => void;
}

/** One AI action with its class, status and undo. */
export default function ActionItem({ action: a, busy, onUndo, onOpenApproval }: ActionItemProps) {
  const { t } = useScreenI18n(messages);
  const undo = canUndo(a);
  return (
    <Card withFooterDivider>
      <Card.Header
        title={a.summary}
        description={[humanize(a.action_type), a.target_table].filter(Boolean).join(" · ")}
        actions={<Badge text={t(`status.${a.status}`)} color={STATUS_COLOR[a.status]} size="small" />}
      />
      <Card.Footer>
        <Layout.Row split gap="sm">
          <Badge text={t(`class.${a.action_class}`)} color={CLASS_COLOR[a.action_class]} size="small" variant="outlined" />
          <Layout.Row gap="xs">
            {a.approval_id ? (
              <Button size="small" variant="tertiary" onClick={onOpenApproval}>
                {t("openApproval")}
              </Button>
            ) : null}
            {undo ? (
              <Button size="small" prefix={<Icon icon={ArrowCounterClockwiseIcon} />} loading={busy} onClick={() => onUndo(a)}>
                {t("undo")}
              </Button>
            ) : null}
          </Layout.Row>
        </Layout.Row>
      </Card.Footer>
    </Card>
  );
}
