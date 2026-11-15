import { ArrowsLeftRightIcon, MapPinIcon, PlusIcon } from "@phosphor-icons/react";
import { Alert, Badge, Button, Card, Checkbox, Icon, InputText, Layout, Page, Select, Tag, Text, TextArea } from "@wonderful/ui-base";
import { useState } from "react";
import { useScreenI18n } from "../../../lib/i18n";
import type { ScreenProps } from "../../../lib/screenRegistry";
import { Empty, LoadView, RichRow } from "../settings/KitView";
import { errorText, objArr, useLoad } from "../settings/kit";
import { personOption } from "../../../shell/RepAvatar";
import messages from "./i18n";
import {
  emptyTerritoryForm, emptyTransfer, enrichFromSeed, formFromTerritory, parsePostalCodes, parseTerritories, repOptions,
  toTerritoryUpsert, toTransfer, validateTerritory, validateTransfer, type Rep, type TerritoryForm, type TransferForm,
} from "./model";

export default function Territories({ client }: ScreenProps) {
  const { t } = useScreenI18n(messages);
  const list = useLoad(async () => {
    const ts = parseTerritories(objArr((await client.call("territories-list", {})).items));
    return client.mock ? enrichFromSeed(ts) : ts;
  }, [client]);
  const [form, setForm] = useState<TerritoryForm | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <Page width="medium">
      <Page.Header
        title={t("screen.management.territories")}
        description={t("subtitle")}
        actions={<Button variant="primary" prefix={<Icon icon={PlusIcon} />} onClick={() => setForm(emptyTerritoryForm())}>{t("add")}</Button>}
      />
      {notice ? (
        <Page.Section>
          <Alert variant="success" title={notice} isClosable onClose={() => setNotice(null)} />
        </Page.Section>
      ) : null}
      <LoadView state={list} onRetry={list.reload} retryLabel={t("retry")} errorTitle={t("common.error")}>
        {(ts) => {
          const reps = repOptions(ts);
          return (
            <>
              {form ? (
                <Page.Section>
                  <TerritoryEditor
                    form={form}
                    reps={reps}
                    onChange={setForm}
                    onCancel={() => setForm(null)}
                    save={async (f) => {
                      await client.call("territory-upsert", toTerritoryUpsert(f));
                      setForm(null);
                      setNotice(t("saved"));
                      list.reload();
                    }}
                  />
                </Page.Section>
              ) : null}
              <Page.Section>
                {ts.length === 0 ? (
                  <Empty title={t("empty")} description={t("emptyHint")} action={{ label: t("add"), onClick: () => setForm(emptyTerritoryForm()) }} />
                ) : (
                  <Card>
                    <Card.Header title={t("list")} />
                    <Card.List>
                      {ts.map((tr) => {
                        const def = tr.reps.find((r) => r.id === tr.default_rep_id);
                        return (
                          <RichRow
                            key={tr.id}
                            avatar={<Icon icon={MapPinIcon} />}
                            title={tr.name}
                            description={
                              <Layout.Stack gap="xs">
                                <Layout.Row gap="xs" wrap>
                                  <Badge size="small" variant="outlined" text={t("codes", { n: tr.postal_codes.length })} />
                                  {tr.reps.length ? tr.reps.map((r) => <Tag key={r.id} text={r.name || r.id.slice(0, 8)} color={r.id === tr.default_rep_id ? "blue" : "default"} />) : <Text variant="sm" color="secondary">{t("noReps")}</Text>}
                                </Layout.Row>
                                {tr.postal_codes.length ? <Text variant="sm" color="secondary">{tr.postal_codes.join(", ")}</Text> : null}
                                {def ? <Text variant="sm" color="secondary">{t("defaultRep")}: {def.name}</Text> : null}
                              </Layout.Stack>
                            }
                            actions={<Button size="small" variant="tertiary" onClick={() => setForm(formFromTerritory(tr))}>{t("edit")}</Button>}
                          />
                        );
                      })}
                    </Card.List>
                  </Card>
                )}
              </Page.Section>
              <Page.Section>
                <TransferCard
                  reps={reps}
                  transfer={async (f) => {
                    const r = await client.call("assignments-transfer", toTransfer(f));
                    setNotice(t("moved", { n: r.moved }));
                    list.reload();
                  }}
                />
              </Page.Section>
            </>
          );
        }}
      </LoadView>
    </Page>
  );
}

function useSubmit(run: () => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await run();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, submit };
}

function TerritoryEditor(p: { form: TerritoryForm; reps: Rep[]; onChange: (f: TerritoryForm) => void; onCancel: () => void; save: (f: TerritoryForm) => Promise<void> }) {
  const { t } = useScreenI18n(messages);
  const f = p.form;
  const [tried, setTried] = useState(false);
  const problems = validateTerritory(f);
  const set = (patch: Partial<TerritoryForm>) => p.onChange({ ...f, ...patch });
  const s = useSubmit(() => p.save(f));
  const bad = parsePostalCodes(f.postal_text).invalid;
  const repOpts = p.reps.map((r) => ({ value: r.id, label: r.name }));
  return (
    <Card withHeaderDivider>
      <Card.Header title={f.territory_id ? t("formEdit") : t("formNew")} />
      <Card.Content>
        <Layout.Stack gap="md">
          <InputText label={t("name")} value={f.name} isError={tried && problems.includes("name")} hint={tried && problems.includes("name") ? t("problem.name") : undefined} onChange={(e) => set({ name: e.target.value })} />
          <TextArea label={t("postal")} hint={bad.length ? t("postalBad", { codes: bad.join(", ") }) : t("postalHint")} isError={bad.length > 0} value={f.postal_text} rows={2} onChange={(e) => set({ postal_text: e.target.value })} />
          <Layout.Stack gap="xs">
            <Text variant="sm" color="secondary">{t("reps")}</Text>
            <Select<string> mode="multiple" options={repOpts} renderOption={personOption} values={f.rep_ids} placeholder={t("pick")} onMultiChange={(v) => set({ rep_ids: v })} />
          </Layout.Stack>
          <Layout.Stack gap="xs">
            <Text variant="sm" color="secondary">{t("defaultRep")}</Text>
            <Select<string>
              options={[{ value: "", label: t("none") }, ...repOpts.filter((o) => f.rep_ids.includes(o.value))]}
              renderOption={personOption} renderValue={personOption}
              value={f.default_rep_id ?? ""}
              status={tried && problems.includes("default_rep") ? "error" : undefined}
              onChange={(v) => set({ default_rep_id: v || null })}
            />
            {tried && problems.includes("default_rep") ? <Text variant="sm" color="danger">{t("problem.default_rep")}</Text> : null}
          </Layout.Stack>
          {s.error ? <Alert variant="error" size="compact" title={t("common.error")} description={s.error} /> : null}
        </Layout.Stack>
      </Card.Content>
      <Card.Footer>
        <Layout.Row gap="sm">
          <Button variant="tertiary" onClick={p.onCancel}>{t("cancel")}</Button>
          <Button variant="primary" loading={s.busy} onClick={() => { setTried(true); if (!problems.length) void s.submit(); }}>{t("save")}</Button>
        </Layout.Row>
      </Card.Footer>
    </Card>
  );
}

function TransferCard(p: { reps: Rep[]; transfer: (f: TransferForm) => Promise<void> }) {
  const { t } = useScreenI18n(messages);
  const [f, setF] = useState<TransferForm>(emptyTransfer);
  const [tried, setTried] = useState(false);
  const problems = validateTransfer(f);
  const set = (patch: Partial<TransferForm>) => setF({ ...f, ...patch });
  const s = useSubmit(async () => {
    await p.transfer(f);
    setF(emptyTransfer());
    setTried(false);
  });
  const opts = p.reps.map((r) => ({ value: r.id, label: r.name }));
  return (
    <Card withHeaderDivider>
      <Card.Header icon={<Icon icon={ArrowsLeftRightIcon} />} title={t("transfer")} description={t("transferHint")} />
      <Card.Content>
        <Layout.Stack gap="md">
          <Layout.Grid idealColumns={2} gap="sm">
            <Layout.Stack gap="xs">
              <Text variant="sm" color="secondary">{t("from")}</Text>
              <Select<string> options={opts} renderOption={personOption} renderValue={personOption} value={f.from_rep_id ?? undefined} placeholder={t("pick")} status={tried && problems.includes("from") ? "error" : undefined} onChange={(v) => set({ from_rep_id: v })} />
            </Layout.Stack>
            <Layout.Stack gap="xs">
              <Text variant="sm" color="secondary">{t("to")}</Text>
              <Select<string> options={opts} renderOption={personOption} renderValue={personOption} value={f.to_rep_id ?? undefined} placeholder={t("pick")} status={tried && (problems.includes("to") || problems.includes("same")) ? "error" : undefined} onChange={(v) => set({ to_rep_id: v })} />
            </Layout.Stack>
          </Layout.Grid>
          <Checkbox isChecked={f.all_accounts} onChange={(v) => set({ all_accounts: v })}>{t("all")}</Checkbox>
          {!f.all_accounts ? (
            <TextArea label={t("accounts")} hint={t("accountsHint")} rows={3} value={f.account_text} isError={tried && (problems.includes("accounts") || problems.includes("account_ids"))} onChange={(e) => set({ account_text: e.target.value })} />
          ) : null}
          <InputText label={t("reason")} placeholder={t("reasonHint")} value={f.reason} onChange={(e) => set({ reason: e.target.value })} />
          {tried && problems.length ? (
            <Alert variant="warning" size="compact" description={problems.map((x) => t(`problem.${x}`)).join(" · ")} />
          ) : null}
          {s.error ? <Alert variant="error" size="compact" title={t("common.error")} description={s.error} /> : null}
        </Layout.Stack>
      </Card.Content>
      <Card.Footer>
        <Button variant="primary" loading={s.busy} onClick={() => { setTried(true); if (!problems.length) void s.submit(); }}>{t("move")}</Button>
      </Card.Footer>
    </Card>
  );
}
