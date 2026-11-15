import { PlusIcon } from "@phosphor-icons/react";
import { Button, Card, Icon, InputText, Layout } from "@wonderful/ui-base";
import { useScreenI18n } from "../../../lib/i18n";
import messages from "./i18n";
import type { AddForm } from "./logic";

export interface AddShopCardProps {
  open: boolean;
  form: AddForm;
  busy: boolean;
  onOpen: (open: boolean) => void;
  onChange: (f: AddForm) => void;
  onSubmit: () => void;
}

/** "New bakery next to Miltos": a rep adds a shop they spotted (fn:candidate-add, REQ-PRS-008). */
export default function AddShopCard(p: AddShopCardProps) {
  const { t } = useScreenI18n(messages);
  if (!p.open) {
    return (
      <Button prefix={<Icon icon={PlusIcon} />} onClick={() => p.onOpen(true)}>
        {t("add.open")}
      </Button>
    );
  }
  const set = (k: keyof AddForm) => (e: { target: { value: string } }) => p.onChange({ ...p.form, [k]: e.target.value });
  return (
    <Card>
      <Card.Header title={t("add.title")} />
      <Card.Content>
        <Layout.Stack gap="sm">
          <InputText label={t("add.name")} value={p.form.name} isRequired autoFocus onChange={set("name")} />
          <InputText label={t("add.location")} placeholder={t("add.locationPh")} value={p.form.location} onChange={set("location")} />
          <InputText label={t("add.website")} type="url" value={p.form.website} onChange={set("website")} />
          <InputText label={t("add.phone")} type="tel" value={p.form.phone} onChange={set("phone")} />
          <Layout.Row gap="sm">
            <Button variant="primary" loading={p.busy} disabled={!p.form.name.trim()} onClick={p.onSubmit}>
              {t("add.go")}
            </Button>
            <Button variant="tertiary" disabled={p.busy} onClick={() => p.onOpen(false)}>
              {t("add.cancel")}
            </Button>
          </Layout.Row>
        </Layout.Stack>
      </Card.Content>
    </Card>
  );
}
