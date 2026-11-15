import { DownloadSimpleIcon, ShieldCheckIcon, TrashIcon } from "@phosphor-icons/react";
import { Alert, Badge, Button, Card, Icon, InputText, Layout, Modal, Page, Tag, Text } from "@wonderful/ui-base";
import { useState } from "react";
import { seedRows } from "../../../contracts";
import { useScreenI18n } from "../../../lib/i18n";
import type { ScreenProps } from "../../../lib/screenRegistry";
import { errorText, isObj, type Obj } from "../settings/kit";
import messages from "./i18n";
import { ERASE_WORD, eraseConfirmed, exportFilename, exportJson, exportSummary, isUuid } from "./model";

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function Gdpr({ client, lang }: ScreenProps) {
  const { t } = useScreenI18n(messages);
  const [contactId, setContactId] = useState("");
  const [exp, setExp] = useState<Obj | null>(null);
  const [busy, setBusy] = useState<"export" | "erase" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [asking, setAsking] = useState(false);
  const [typed, setTyped] = useState("");
  const id = contactId.trim();
  const valid = isUuid(id);
  const samples = client.mock ? seedRows("contact").slice(0, 4) : [];

  const doExport = async () => {
    setBusy("export");
    setError(null);
    setResult(null);
    try {
      const r = await client.call("contact-export", { contact_id: id });
      setExp(isObj(r.export) ? r.export : {});
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };
  const doErase = async () => {
    setBusy("erase");
    setError(null);
    try {
      const r = await client.call("contact-erase", { contact_id: id, confirm: true });
      setResult({ ok: r.erased, text: r.erased ? t("erased") : t("notErased") });
      setExp(null);
      setAsking(false);
      setTyped("");
      if (r.erased) setContactId("");
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Page width="medium">
      <Page.Header title={t("screen.management.gdpr")} description={t("subtitle")} actions={<Badge color="orange" text={t("humanOnly")} startIcon={<Icon icon={ShieldCheckIcon} />} />} />
      <Page.Section>
        <Card>
          <Card.Content>
            <Layout.Stack gap="md">
              <InputText
                label={t("contact")}
                hint={id && !valid ? t("badId") : t("contactHint")}
                isError={!!id && !valid}
                value={contactId}
                placeholder="00000000-0000-0000-0000-000000000000"
                onChange={(e) => { setContactId(e.target.value); setExp(null); setResult(null); }}
              />
              {samples.length ? (
                <Layout.Stack gap="xs">
                  <Text variant="sm" color="secondary">{t("samples")}</Text>
                  <Layout.Row gap="xs" wrap>
                    {samples.map((c) => (
                      <Tag key={String(c.id)} text={String(c.full_name)} onClick={() => { setContactId(String(c.id)); setExp(null); setResult(null); }} />
                    ))}
                  </Layout.Row>
                </Layout.Stack>
              ) : null}
              <Text variant="sm" color="secondary">{t("audit")}</Text>
              {error ? <Alert variant="error" size="compact" title={t("common.error")} description={error} /> : null}
              {result ? <Alert variant={result.ok ? "success" : "warning"} title={result.text} /> : null}
            </Layout.Stack>
          </Card.Content>
          <Card.Footer>
            <Layout.Row gap="sm" wrap>
              <Button color="danger" variant="secondary" prefix={<Icon icon={TrashIcon} />} disabled={!valid || busy !== null} onClick={() => setAsking(true)}>
                {t("erase")}
              </Button>
              <Button variant="primary" prefix={<Icon icon={DownloadSimpleIcon} />} disabled={!valid} loading={busy === "export"} onClick={() => void doExport()}>
                {t("export")}
              </Button>
            </Layout.Row>
          </Card.Footer>
        </Card>
      </Page.Section>
      {exp ? (
        <Page.Section>
          <Card withHeaderDivider>
            <Card.Header
              title={t("exportTitle")}
              description={t("exportDesc")}
              actions={<Button size="small" prefix={<Icon icon={DownloadSimpleIcon} />} onClick={() => download(exportFilename(id), exportJson(exp))}>{t("download")}</Button>}
            />
            <Card.Content>
              <Layout.Stack gap="sm">
                <Layout.Row gap="xs" wrap>
                  {exportSummary(exp).map((s) => <Badge key={s.key} size="small" variant="outlined" text={t("sections", { key: s.key, n: s.count })} />)}
                </Layout.Row>
                <Text as="span" variant="sm" color="secondary" code className="merc-pre">{exportJson(exp).slice(0, 4000)}</Text>
              </Layout.Stack>
            </Card.Content>
          </Card>
        </Page.Section>
      ) : null}
      <Modal
        open={asking}
        onClose={() => { setAsking(false); setTyped(""); }}
        title={t("eraseTitle")}
        footer={
          <Modal.Footer>
            <Button variant="tertiary" onClick={() => { setAsking(false); setTyped(""); }}>{t("cancel")}</Button>
            <Button color="danger" variant="primary" disabled={!eraseConfirmed(typed)} loading={busy === "erase"} onClick={() => void doErase()}>{t("eraseConfirm")}</Button>
          </Modal.Footer>
        }
      >
        <Layout.Stack gap="md">
          <Text variant="md">{t("eraseDesc")}</Text>
          <Text variant="sm" color="secondary">{id}</Text>
          <InputText label={t("eraseType", { word: ERASE_WORD[lang] })} value={typed} onChange={(e) => setTyped(e.target.value)} />
        </Layout.Stack>
      </Modal>
    </Page>
  );
}
