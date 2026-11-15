import { Button, Card, InputText, Layout, Text } from "@wonderful/ui-base";
import { useState } from "react";
import { useScreenI18n } from "../../../lib/i18n";
import { validateContact, type ContactDraft, type ContactErrors } from "./customersModel";
import messages from "./i18n";

const EMPTY: ContactDraft = { full_name: "", role_title: "", phone: "" };

/** Inline "add contact" form; `onSave` resolves true when the contact was stored. */
export default function ContactForm(props: { onSave: (d: ContactDraft) => Promise<boolean>; onCancel: () => void }) {
  const { t } = useScreenI18n(messages);
  const [draft, setDraft] = useState<ContactDraft>(EMPTY);
  const [errors, setErrors] = useState<ContactErrors>({});
  const [busy, setBusy] = useState(false);
  const set = (k: keyof ContactDraft) => (e: { target: { value: string } }) => setDraft((d) => ({ ...d, [k]: e.target.value }));
  const submit = async () => {
    const errs = validateContact(draft);
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    const ok = await props.onSave(draft);
    setBusy(false);
    if (ok) setDraft(EMPTY);
  };
  return (
    <Card variant="secondary">
      <Card.Content>
        <Layout.Stack gap="sm">
          <InputText label={t("contactName")} value={draft.full_name} onChange={set("full_name")} isRequired isError={!!errors.full_name} autoComplete="name" />
          {errors.full_name ? <Text variant="sm" color="danger">{t(errors.full_name)}</Text> : null}
          <InputText label={t("contactRole")} value={draft.role_title} onChange={set("role_title")} />
          <InputText label={t("contactPhone")} value={draft.phone} onChange={set("phone")} type="tel" inputMode="tel" isError={!!errors.phone} autoComplete="tel" />
          {errors.phone ? <Text variant="sm" color="danger">{t(errors.phone)}</Text> : null}
        </Layout.Stack>
      </Card.Content>
      <Card.Footer>
        <Layout.Row gap="sm">
          <Button variant="tertiary" onClick={props.onCancel}>{t("cancel")}</Button>
          <Button variant="primary" loading={busy} onClick={() => void submit()}>{t("save")}</Button>
        </Layout.Row>
      </Card.Footer>
    </Card>
  );
}
