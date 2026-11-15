import { MegaphoneIcon, SparkleIcon } from "@phosphor-icons/react";
import { Alert, Badge, Button, Card, Icon, InputText, Layout, Page, Select, Tag, Text, TextArea } from "@wonderful/ui-base";
import { useState } from "react";
import { useScreenI18n } from "../../../lib/i18n";
import type { ScreenProps } from "../../../lib/screenRegistry";
import { Empty, LoadView, RichRow } from "../settings/KitView";
import { errorText, objArr, todayIso, useLoad } from "../settings/kit";
import messages from "./i18n";
import {
  draftOf, emptyForm, formFromCampaign, formFromDraft, parseCampaigns, parseFunnel, pct, STATUSES, toUpsert, validateForm,
  type Campaign, type CampaignForm, type CampaignStatus,
} from "./model";

const STATUS_COLOR: Record<CampaignStatus, "muted" | "green" | "neutral"> = { draft: "muted", active: "green", ended: "neutral" };

export default function Campaigns({ client }: ScreenProps) {
  const { t } = useScreenI18n(messages);
  const list = useLoad(async () => parseCampaigns(objArr((await client.call("campaigns-list", {})).items)), [client]);
  const [text, setText] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [form, setForm] = useState<CampaignForm | null>(null);
  const [unresolved, setUnresolved] = useState<string[]>([]);
  const [selected, setSelected] = useState<Campaign | null>(null);

  const draft = async () => {
    setDrafting(true);
    setDraftError(null);
    try {
      const r = await client.call("campaign-draft-from-text", { text: text.trim() });
      setForm(formFromDraft(draftOf(r), text, todayIso()));
      setUnresolved(r.unresolved);
    } catch (e) {
      setDraftError(errorText(e));
    } finally {
      setDrafting(false);
    }
  };

  return (
    <Page width="medium">
      <Page.Header title={t("screen.management.campaigns")} description={t("subtitle")} />
      <Page.Section>
        <Card>
          <Card.Header icon={<Icon icon={SparkleIcon} />} title={t("fromText")} />
          <Card.Content>
            <Layout.Stack gap="sm">
              <TextArea aria-label={t("fromText")} placeholder={t("fromTextHint")} value={text} rows={3} onChange={(e) => setText(e.target.value)} />
              {draftError ? <Alert variant="error" size="compact" title={t("common.error")} description={draftError} /> : null}
            </Layout.Stack>
          </Card.Content>
          <Card.Footer>
            <Layout.Row gap="sm" wrap>
              <Button variant="tertiary" onClick={() => { setForm(emptyForm(todayIso())); setUnresolved([]); }}>
                {t("newBlank")}
              </Button>
              <Button variant="primary" loading={drafting} disabled={!text.trim()} onClick={() => void draft()}>
                {t("draft")}
              </Button>
            </Layout.Row>
          </Card.Footer>
        </Card>
      </Page.Section>
      {form ? (
        <Page.Section>
          <CampaignEditor
            form={form}
            unresolved={unresolved}
            onChange={setForm}
            onCancel={() => setForm(null)}
            onSaved={() => { setForm(null); setUnresolved([]); setText(""); list.reload(); }}
            save={(f) => client.call("campaign-upsert", toUpsert(f))}
          />
        </Page.Section>
      ) : null}
      {selected ? (
        <Page.Section>
          <FunnelCard campaign={selected} load={(id) => client.call("campaign-funnel", { campaign_id: id })} onClose={() => setSelected(null)} />
        </Page.Section>
      ) : null}
      <Page.Section>
        <LoadView state={list} onRetry={list.reload} retryLabel={t("retry")} errorTitle={t("common.error")}>
          {(items) =>
            items.length === 0 ? (
              <Empty title={t("empty")} description={t("emptyHint")} />
            ) : (
              <Card>
                <Card.Header title={t("list")} />
                <Card.List>
                  {items.map((c) => {
                    const editable = formFromCampaign(c);
                    return (
                      <RichRow
                        key={c.id}
                        avatar={<Icon icon={MegaphoneIcon} />}
                        title={
                          <Layout.Row gap="xs" wrap>
                            <Text variant="md" weight="medium">{c.title}</Text>
                            <Badge size="small" color={STATUS_COLOR[c.status]} text={t(`status.${c.status}`)} />
                          </Layout.Row>
                        }
                        description={`${t("dates", { from: c.starts_on, to: c.ends_on })} · ${c.message}`}
                        actions={
                          <Layout.Row gap="xs">
                            <Button size="small" variant="tertiary" onClick={() => setSelected(c)}>{t("funnel")}</Button>
                            {editable ? (
                              <Button size="small" variant="tertiary" onClick={() => { setForm(editable); setUnresolved([]); }}>{t("edit")}</Button>
                            ) : null}
                          </Layout.Row>
                        }
                      />
                    );
                  })}
                </Card.List>
              </Card>
            )
          }
        </LoadView>
      </Page.Section>
    </Page>
  );
}

function CampaignEditor(p: {
  form: CampaignForm;
  unresolved: string[];
  onChange: (f: CampaignForm) => void;
  onCancel: () => void;
  onSaved: () => void;
  save: (f: CampaignForm) => Promise<unknown>;
}) {
  const { t } = useScreenI18n(messages);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const f = p.form;
  const problems = validateForm(f);
  const set = (patch: Partial<CampaignForm>) => p.onChange({ ...f, ...patch });

  const submit = async () => {
    setTried(true);
    if (problems.length) return;
    setBusy(true);
    setError(null);
    try {
      await p.save(f);
      p.onSaved();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  const links: { key: "products" | "territories" | "categories" | "reps"; ids: string[] }[] = [
    { key: "products", ids: f.product_ids },
    { key: "territories", ids: f.territory_ids },
    { key: "categories", ids: f.category_ids },
    { key: "reps", ids: f.rep_ids },
  ];

  return (
    <Card withHeaderDivider>
      <Card.Header title={f.campaign_id ? t("form") : t("formNew")} />
      <Card.Content>
        <Layout.Stack gap="md">
          {p.unresolved.length ? (
            <Alert
              variant="warning"
              title={t("unresolved")}
              >
                <Layout.Stack gap="xs">
                  <Text variant="sm">{t("unresolvedHint")}</Text>
                  <Layout.Row gap="xs" wrap>
                    {p.unresolved.map((n) => <Tag key={n} text={n} color="orange" />)}
                  </Layout.Row>
                </Layout.Stack>
            </Alert>
          ) : null}
          <InputText label={t("title")} value={f.title} isError={tried && problems.includes("title")} hint={tried && problems.includes("title") ? t("problem.title") : undefined} onChange={(e) => set({ title: e.target.value })} />
          <TextArea label={t("message")} value={f.message} rows={3} isError={tried && problems.includes("message")} hint={tried && problems.includes("message") ? t("problem.message") : undefined} onChange={(e) => set({ message: e.target.value })} />
          <Layout.Grid idealColumns={3} gap="sm">
            <InputText type="date" label={t("starts")} value={f.starts_on} isError={tried && problems.includes("dates")} onChange={(e) => set({ starts_on: e.target.value })} />
            <InputText type="date" label={t("ends")} value={f.ends_on} isError={tried && (problems.includes("dates") || problems.includes("order"))} hint={tried && problems.includes("order") ? t("problem.order") : undefined} onChange={(e) => set({ ends_on: e.target.value })} />
            <Layout.Stack gap="xs">
              <Text variant="sm" color="secondary">{t("status")}</Text>
              <Select<CampaignStatus> options={STATUSES.map((s) => ({ value: s, label: t(`status.${s}`) }))} value={f.status} onChange={(v) => set({ status: v })} />
            </Layout.Stack>
          </Layout.Grid>
          <Layout.Stack gap="xs">
            {links.map((l) => {
              const names = f.names[l.key];
              return (
                <Layout.Row key={l.key} gap="xs" wrap>
                  <Text variant="sm" color="secondary">{t(l.key)}:</Text>
                  {names.length ? names.map((n) => <Tag key={n} text={n} color="blue" />) : null}
                  <Badge size="small" variant="outlined" text={t("linked", { n: l.ids.length })} />
                </Layout.Row>
              );
            })}
          </Layout.Stack>
          {error ? <Alert variant="error" size="compact" title={t("common.error")} description={error} /> : null}
        </Layout.Stack>
      </Card.Content>
      <Card.Footer>
        <Layout.Row gap="sm">
          <Button variant="tertiary" onClick={p.onCancel}>{t("cancel")}</Button>
          <Button variant="primary" loading={busy} onClick={() => void submit()}>{t("save")}</Button>
        </Layout.Row>
      </Card.Footer>
    </Card>
  );
}

function FunnelCard(p: {
  campaign: Campaign;
  load: (id: string) => Promise<Parameters<typeof parseFunnel>[0]>;
  onClose: () => void;
}) {
  const { t } = useScreenI18n(messages);
  const state = useLoad(async () => parseFunnel(await p.load(p.campaign.id)), [p.campaign.id]);
  return (
    <Card withHeaderDivider>
      <Card.Header title={t("funnelOf", { title: p.campaign.title })} actions={<Button size="small" variant="tertiary" onClick={p.onClose}>{t("close")}</Button>} />
      <Card.Content>
        <LoadView state={state} onRetry={state.reload} retryLabel={t("retry")} errorTitle={t("common.error")} rows={2}>
          {(fu) =>
            fu.shown === 0 && fu.byRep.length === 0 ? (
              <Text variant="sm" color="secondary">{t("noFunnel")}</Text>
            ) : (
              <Layout.Stack gap="md">
                <Layout.Grid columns={3} gap="sm">
                  {(["shown", "pitched", "ordered"] as const).map((k) => (
                    <Card key={k} variant="secondary">
                      <Card.Header title={t(k)} />
                      <Card.Stat value={String(fu[k])} />
                      {k !== "shown" ? (
                        <Card.Content>
                          <Text variant="sm" color="secondary">{t("conv", { p: pct(fu[k], fu.shown) })}</Text>
                        </Card.Content>
                      ) : null}
                    </Card>
                  ))}
                </Layout.Grid>
                {fu.byRep.length ? (
                  <Layout.Stack gap="xs">
                    <Text variant="sm" weight="medium">{t("byRep")}</Text>
                    {fu.byRep.map((r) => (
                      <Text key={r.name} variant="sm" color="secondary">
                        {r.name}: {t("repLine", { shown: r.shown, pitched: r.pitched, ordered: r.ordered })}
                      </Text>
                    ))}
                  </Layout.Stack>
                ) : null}
              </Layout.Stack>
            )
          }
        </LoadView>
      </Card.Content>
    </Card>
  );
}
