import { CheckCircleIcon, UploadSimpleIcon, WarningIcon } from "@phosphor-icons/react";
import { Alert, Badge, Button, Card, Checkbox, FileUpload, Icon, Layout, Page, Select, Steps, Text } from "@wonderful/ui-base";
import { useEffect, useRef, useState } from "react";
import { useScreenI18n } from "../../../lib/i18n";
import type { ScreenProps } from "../../../lib/screenRegistry";
import { RichRow } from "../settings/KitView";
import { errorText, type Obj } from "../settings/kit";
import messages from "./i18n";
import {
  bytesToBase64, canApply, CONFIRM_BELOW, confidencePct, DATA_TYPES, demoMapping, DONE, duplicateTargets, effective, isReady,
  needsConfirm, parseCsv, parseImport, pendingConfirmations, TARGET_FIELDS, toOverrides, type DataType, type Edits, type ImportView,
} from "./model";

const POLL_MS = 1500;
const POLL_MAX = 40;
const MAX_BYTES = 5 * 1024 * 1024;

type Phase =
  | { k: "pick" }
  | { k: "mapping"; importId: string }
  | { k: "review"; importId: string; view: ImportView }
  | { k: "done"; status: string };

export default function ImportScreen({ client }: ScreenProps) {
  const { t } = useScreenI18n(messages);
  const [type, setType] = useState<DataType>("accounts");
  const [baseline, setBaseline] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [local, setLocal] = useState<{ headers: string[]; rows: string[][] } | null>(null);
  const [phase, setPhase] = useState<Phase>({ k: "pick" });
  const [edits, setEdits] = useState<Edits>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const reset = () => { setPhase({ k: "pick" }); setFile(null); setLocal(null); setEdits({}); setError(null); };

  /** Mock answers carry no mapping: build the demo one from the file (see demoMapping). */
  const withDemo = (v: ImportView): ImportView => {
    if (!client.mock || v.mapping.length || !local) return v;
    const preview = local.rows.slice(0, 5).map((r) => Object.fromEntries(local.headers.map((h, i) => [h, r[i] ?? ""])));
    return { ...v, status: v.status || "preview", rows_total: v.rows_total ?? local.rows.length, mapping: demoMapping(local.headers, type), preview };
  };

  const poll = async (importId: string) => {
    for (let i = 0; i < POLL_MAX && alive.current; i++) {
      const v = withDemo(parseImport(await client.call("import-get", { import_id: importId })));
      if (isReady(v) || client.mock) return v;
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
    return withDemo(parseImport(await client.call("import-get", { import_id: importId })));
  };

  const start = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const csv_base64 = bytesToBase64(new Uint8Array(await file.arrayBuffer()));
      const r = await client.call("import-start", { data_type: type, filename: file.name, csv_base64, is_baseline: baseline });
      setPhase({ k: "mapping", importId: r.import_id });
      const view = await poll(r.import_id);
      if (alive.current) setPhase({ k: "review", importId: r.import_id, view });
    } catch (e) {
      setError(errorText(e));
      setPhase({ k: "pick" });
    } finally {
      setBusy(false);
    }
  };

  const choose = async (files: File[]) => {
    const f = files[0];
    setError(null);
    if (!f) return;
    if (f.size > MAX_BYTES) { setError(`${t("fileRead")}: > 5 MB`); return; }
    try {
      setLocal(parseCsv(await f.text()));
      setFile(f);
    } catch (e) {
      setError(`${t("fileRead")}: ${errorText(e)}`);
    }
  };

  const apply = async (importId: string, view: ImportView) => {
    setBusy(true);
    setError(null);
    try {
      const r = await client.call("import-confirm", toOverrides(importId, view.mapping, edits));
      setPhase({ k: "done", status: r.status });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const step = phase.k === "pick" ? 0 : phase.k === "done" ? 3 : phase.k === "mapping" ? 1 : 2;
  return (
    <Page width="medium">
      <Page.Header title={t("screen.management.import")} description={t("subtitle")} />
      <Page.Section>
        <Steps current={step} size="small" items={[{ title: t("step1") }, { title: t("step2") }, { title: t("step3") }]} />
      </Page.Section>
      {error ? (
        <Page.Section>
          <Alert variant="error" title={t("common.error")} description={error} />
        </Page.Section>
      ) : null}
      {phase.k === "pick" || phase.k === "mapping" ? (
        <Page.Section>
          <Card>
            <Card.Content>
              <Layout.Stack gap="md">
                <Layout.Stack gap="xs">
                  <Text variant="sm" color="secondary">{t("type")}</Text>
                  <Select<DataType> options={DATA_TYPES.map((d) => ({ value: d, label: t(`type.${d}`) }))} value={type} isDisabled={phase.k !== "pick"} onChange={setType} />
                </Layout.Stack>
                <FileUpload.Area title={t("drop")} description={t("dropHint")} accept=".csv,text/csv" size="md" files={file ? [file] : []} onSelect={(fs) => void choose(fs)} onRemove={() => { setFile(null); setLocal(null); }} disabled={phase.k !== "pick"} />
                <Checkbox isChecked={baseline} onChange={setBaseline}>{t("baseline")}</Checkbox>
                {local ? <Text variant="sm" color="secondary">{t("rows", { n: local.rows.length })} · {local.headers.join(", ")}</Text> : null}
                {phase.k === "mapping" ? <Alert variant="info" size="compact" title={t("mapping")} /> : null}
              </Layout.Stack>
            </Card.Content>
            <Card.Footer>
              <Button variant="primary" prefix={<Icon icon={UploadSimpleIcon} />} disabled={!file} loading={busy} onClick={() => void start()}>{t("upload")}</Button>
            </Card.Footer>
          </Card>
        </Page.Section>
      ) : null}
      {phase.k === "review" ? (
        <Review t={t} mock={client.mock} type={type} view={phase.view} edits={edits} setEdits={setEdits} busy={busy}
          onApply={() => void apply(phase.importId, phase.view)} onReset={reset} />
      ) : null}
      {phase.k === "done" ? (
        <Page.Section>
          <Alert variant={DONE.has(phase.status) && phase.status === "failed" ? "error" : "success"} title={t("applied", { status: phase.status })}
            action={<Button size="small" onClick={reset}>{t("startOver")}</Button>} />
        </Page.Section>
      ) : null}
    </Page>
  );
}

type T = ReturnType<typeof useScreenI18n<keyof (typeof messages)["en"]>>["t"];

function Review(p: { t: T; mock: boolean; type: DataType; view: ImportView; edits: Edits; setEdits: (e: Edits) => void; busy: boolean; onApply: () => void; onReset: () => void }) {
  const { t, view, edits } = p;
  const pending = pendingConfirmations(view.mapping, edits);
  const dups = duplicateTargets(view.mapping, edits);
  const fieldOpts = [{ value: "", label: t("skip") }, ...TARGET_FIELDS[p.type].map((f) => ({ value: f, label: f }))];
  const edit = (col: string, target_field: string | null) => p.setEdits({ ...edits, [col]: { target_field, confirmed: true } });
  const cols = view.preview.length ? Object.keys(view.preview[0]!) : [];
  return (
    <>
      <Page.Section>
        <Card withHeaderDivider>
          <Card.Header
            title={t("columns")}
            description={t("columnsHint", { pct: confidencePct(CONFIRM_BELOW) })}
            actions={pending.length ? <Badge color="orange" text={t("needs", { n: pending.length })} /> : <Badge color="green" text={t("confirmed")} />}
          />
          {p.mock ? (
            <Card.Content>
              <Text variant="sm" color="secondary">{t("mockNote")}</Text>
            </Card.Content>
          ) : null}
          {view.mapping.length === 0 ? (
            <Card.Content>
              <Text variant="sm" color="secondary">{t("noMapping")}</Text>
            </Card.Content>
          ) : (
            <Card.List>
              {view.mapping.map((m0) => {
                const m = effective(m0, edits);
                const unsure = needsConfirm(m);
                return (
                  <RichRow
                    key={m.source_column}
                    avatar={<Icon icon={unsure ? WarningIcon : CheckCircleIcon} />}
                    title={m.source_column}
                    description={
                      <Layout.Row gap="xs" wrap>
                        <Badge size="small" color={m.confidence < CONFIRM_BELOW ? "orange" : "green"} text={t("confidence", { pct: confidencePct(m.confidence) })} />
                        {m.confirmed && m.confidence < CONFIRM_BELOW ? <Badge size="small" color="blue" text={t("confirmed")} /> : null}
                      </Layout.Row>
                    }
                    actions={
                      <Layout.Row gap="xs">
                        <Select<string> size="small" aria-label={`${t("target")} ${m.source_column}`} options={fieldOpts} value={m.target_field ?? ""} status={m.target_field && dups.includes(m.target_field) ? "error" : unsure ? "warning" : undefined} onChange={(v) => edit(m.source_column, v || null)} />
                        {unsure ? <Button size="small" onClick={() => edit(m.source_column, m.target_field)}>{t("confirm")}</Button> : null}
                      </Layout.Row>
                    }
                  />
                );
              })}
            </Card.List>
          )}
        </Card>
      </Page.Section>
      {view.preview.length ? (
        <Page.Section>
          <Card>
            <Card.Header title={t("preview")} description={t("previewHint", { n: view.preview.length })} />
            <Card.List>
              {view.preview.map((row: Obj, i) => (
                <Card.Meta key={i} title={String(row[cols[0]!] ?? "")} description={cols.slice(1).map((c) => `${c}: ${String(row[c] ?? "")}`).join(" · ")} />
              ))}
            </Card.List>
          </Card>
        </Page.Section>
      ) : null}
      <Page.Section>
        <Card>
          <Card.Header title={t("issues")} description={view.rows_total !== null ? t("rows", { n: view.rows_total }) : undefined} />
          <Card.Content>
            {view.issues.length ? (
              <Layout.Stack gap="xs">
                {view.issues.slice(0, 20).map((x) => (
                  <Text key={`${x.row_no}-${x.issue_type}`} variant="sm" color="warning">
                    {t("issueLine", { row: x.row_no, type: t(`issue.${x.issue_type}` as never) })}{x.detail ? ` · ${x.detail}` : ""}
                  </Text>
                ))}
              </Layout.Stack>
            ) : (
              <Text variant="sm" color="secondary">{t("noIssues")}</Text>
            )}
          </Card.Content>
        </Card>
      </Page.Section>
      <Page.Footer sticky>
        <Layout.Stack gap="sm">
          {dups.length ? <Alert variant="warning" size="compact" title={t("dup", { fields: dups.join(", ") })} /> : null}
          <Layout.Row split>
            <Button variant="tertiary" onClick={p.onReset}>{t("startOver")}</Button>
            <Button variant="primary" disabled={!canApply(view.mapping, edits)} loading={p.busy} onClick={p.onApply}>{t("apply")}</Button>
          </Layout.Row>
        </Layout.Stack>
      </Page.Footer>
    </>
  );
}
