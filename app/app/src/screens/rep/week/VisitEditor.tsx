import { Button, Card, InputText, Layout, Select } from "@wonderful/ui-base";
import { useScreenI18n } from "../../../lib/i18n";
import { formatDay } from "../approvals/kit/format";
import messages from "./i18n";
import type { EditState } from "./logic";

export interface VisitEditorProps {
  edit: EditState;
  days: readonly string[];
  busy: boolean;
  onChange: (e: EditState) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Move (pick a day of the week) or skip a visit, with the reason logged in visit_change (REQ-PLN-003). */
export default function VisitEditor({ edit, days, busy, onChange, onConfirm, onCancel }: VisitEditorProps) {
  const { t, lang } = useScreenI18n(messages);
  return (
    <Card.Content>
      <Layout.Stack gap="sm">
        {edit.mode === "move" ? (
          <Select
            aria-label={t("edit.day")}
            options={days.map((d) => ({ value: d, label: formatDay(d, lang) }))}
            value={edit.date}
            onChange={(date) => onChange({ ...edit, date })}
          />
        ) : null}
        <InputText label={t("edit.reason")} placeholder={t("edit.reasonPh")} value={edit.reason} onChange={(e) => onChange({ ...edit, reason: e.target.value })} />
        <Layout.Row gap="sm">
          <Button variant="primary" size="small" loading={busy} onClick={onConfirm}>
            {edit.mode === "move" ? t("edit.confirmMove") : t("edit.confirmSkip")}
          </Button>
          <Button variant="tertiary" size="small" disabled={busy} onClick={onCancel}>
            {t("edit.cancel")}
          </Button>
        </Layout.Row>
      </Layout.Stack>
    </Card.Content>
  );
}
