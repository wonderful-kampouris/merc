import { Badge, Button, Card, Icon, InputNumber, InputText, Layout, Modal, Notice, Page, Progress, Select, Text, ToggleGroup, Tooltip } from "@wonderful/ui-base";
import { ArrowsClockwiseIcon, PencilSimpleIcon, PlusIcon } from "@phosphor-icons/react";
import { useState } from "react";
import type { TargetProgress } from "../../../contracts";
import { MercApiError, type MercClient } from "../../../lib/client";
import { screenTitleKey, useScreenI18n, type Lang } from "../../../lib/i18n";
import type { ScreenProps } from "../../../lib/screenRegistry";
import { paceColor, targetFigures, targetPace } from "../dashboard/logic";
import { directory, useDirectory, type Directory } from "../dashboard/shared/directory";
import { errorDetail, errorKey } from "../dashboard/shared/errors";
import { date, pct } from "../dashboard/shared/format";
import { Region } from "../dashboard/shared/Region";
import { useAsync } from "../dashboard/shared/useAsync";
import RepAvatar, { personOption } from "../../../shell/RepAvatar";
import messages from "./i18n";
import { blankForm, byMetric, formFromTarget, knowsScope, listRequest, METRICS, PERIOD_CHOICES, SCOPES, upsertRequest, validate, type PeriodChoice, type TargetForm } from "./logic";

type Key = keyof typeof messages.en;
type T = ReturnType<typeof useScreenI18n<Key>>["t"];

/** Sales targets (REQ-TGT-001, progress per metrics.md#target-progress): list by period, create and edit; overlaps are rejected by target-upsert. */
export default function Targets({ screen, client, lang }: ScreenProps) {
  const { t } = useScreenI18n(messages);
  const [choice, setChoice] = useState<PeriodChoice>("this");
  const [form, setForm] = useState<{ value: TargetForm; scopeKnown: boolean } | null>(null);
  const [saved, setSaved] = useState(false);
  const req = listRequest(choice);
  const state = useAsync(() => client.call("targets-list", req), JSON.stringify(req));
  const dir = useDirectory(client, screen.functions);

  return (
    <>
      <Page width="full">
        <Page.Header
          title={t(screenTitleKey(screen.shell, screen.key))}
          description={t("subtitle")}
          actions={
            <Layout.Row gap="xs" wrap>
              <Tooltip content={t("retry")}>
                <Button size="small" variant="tertiary" aria-label={t("retry")} prefix={<Icon icon={ArrowsClockwiseIcon} />} onClick={state.reload} />
              </Tooltip>
              <Button size="small" variant="primary" prefix={<Icon icon={PlusIcon} />} onClick={() => setForm({ value: blankForm(), scopeKnown: true })}>
                {t("new")}
              </Button>
            </Layout.Row>
          }
        />
        <Page.Toolbar>
          <Layout.Row gap="sm" wrap>
            {client.mock ? <Badge text={t("mock.note")} color="purple" size="small" /> : null}
            <Select
              size="small"
              aria-label={t("period.this")}
              value={choice}
              onChange={(v) => setChoice(v as PeriodChoice)}
              options={PERIOD_CHOICES.map((c) => ({ value: c, label: t(`period.${c}` as Key) }))}
            />
          </Layout.Row>
        </Page.Toolbar>
        {saved ? (
          <Page.Section>
            <Notice size="compact" description={t("form.saved")} />
          </Page.Section>
        ) : null}
        <Page.Section>
          <Region state={state} t={t} rows={6} isEmpty={(d) => d.items.length === 0} emptyTitle={t("empty")} emptyBody={t("emptyBody")}>
            {(d) => <TargetsView items={d.items} dir={dir} lang={lang} t={t} onEdit={(x) => setForm({ value: formFromTarget(x), scopeKnown: knowsScope(x) })} />}
          </Region>
        </Page.Section>
      </Page>
      {form ? (
        <TargetModal
          client={client}
          dir={dir}
          initial={form.value}
          scopeKnown={form.scopeKnown}
          lang={lang}
          t={t}
          onClose={() => setForm(null)}
          onSaved={() => {
            setForm(null);
            setSaved(true);
            state.reload();
          }}
        />
      ) : null}
    </>
  );
}

/** Pure list view (tested with SSR): one card per metric, one row per target with a pace-coloured bar. */
export function TargetsView(props: { items: readonly TargetProgress[]; dir?: Directory; lang: Lang; t: T; onEdit: (t: TargetProgress) => void }) {
  const { lang, t } = props;
  const dir = props.dir ?? directory();
  return (
    <Layout.Grid idealColumns={2}>
      {byMetric(props.items).map((g) => (
        <Card key={g.metric}>
          <Card.Header title={t(`metric.${g.metric}` as Key)} />
          <Card.List>
            {g.items.map((x) => {
              const f = targetFigures(x, lang);
              const pace = targetPace(x);
              const extra = x as TargetProgress & Record<string, unknown>;
              const repName = dir.name("user", extra.user_id);
              const who = repName ?? dir.name("territory", extra.territory_id) ?? (extra.scope === "org" ? t("scope.org") : null);
              return (
                <Card.List.Item key={x.target_id}>
                  <Layout.Stack gap="xs">
                    <Layout.Row split>
                      <Layout.Row gap="xs">
                        {repName ? <RepAvatar name={repName} /> : null}
                        <Text variant="body-sm">{who ?? t("row.period", { from: date(x.period_start, lang), to: date(x.period_end, lang) })}</Text>
                      </Layout.Row>
                      <Layout.Row gap="xs">
                        <Badge text={t(`pace.${pace}` as Key)} color={pace === "ahead" ? "green" : pace === "behind" ? "orange" : "red"} size="small" />
                        <Tooltip content={t("row.edit")}>
                          <Button size="small" variant="tertiary" aria-label={t("row.edit")} prefix={<Icon icon={PencilSimpleIcon} />} onClick={() => props.onEdit(x)} />
                        </Tooltip>
                      </Layout.Row>
                    </Layout.Row>
                    <Progress value={Math.min(100, Math.max(0, x.pct))} color={paceColor(pace)} showInfo={false} />
                    <Text variant="body-sm" color="secondary">
                      {t("row.progress", { a: f.actual, b: f.target, pct: pct(x.pct, lang) })} · {t("row.days", { n: x.days_left })}
                    </Text>
                  </Layout.Stack>
                </Card.List.Item>
              );
            })}
          </Card.List>
        </Card>
      ))}
    </Layout.Grid>
  );
}

function TargetModal(props: { client: MercClient; dir: Directory; initial: TargetForm; scopeKnown: boolean; lang: Lang; t: T; onClose: () => void; onSaved: () => void }) {
  const { t } = props;
  const [f, setF] = useState<TargetForm>(props.initial);
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const problems = validate(f);
  const dir = props.dir;
  const save = async () => {
    setTouched(true);
    if (problems.length) return;
    setBusy(true);
    setErr(null);
    try {
      await props.client.call("target-upsert", upsertRequest(f));
      props.onSaved();
    } catch (e) {
      setErr(e instanceof MercApiError && e.code === "conflict" ? t("form.overlap") : `${t(errorKey(e))} ${errorDetail(e)}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={props.onClose}
      title={f.target_id ? t("edit") : t("new")}
      footer={
        <Modal.Footer>
          <Button variant="secondary" onClick={props.onClose}>
            {t("form.cancel")}
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void save()}>
            {t("form.save")}
          </Button>
        </Modal.Footer>
      }
    >
      <Layout.Stack gap="md">
        {!props.scopeKnown ? <Notice size="compact" variant="neutral" description={t("edit.scopeNote")} /> : null}
        <Layout.Stack gap="xs">
          <Text variant="body-sm">{t("form.scope")}</Text>
          <ToggleGroup value={f.scope} onChange={(v) => setF({ ...f, scope: v as TargetForm["scope"] })} size="small" isFullWidth aria-label={t("form.scope")}>
            {SCOPES.map((s) => (
              <ToggleGroup.Item key={s} value={s} text={t(`scope.${s}` as Key)} />
            ))}
          </ToggleGroup>
        </Layout.Stack>
        {f.scope === "user" ? (
          <Select aria-label={t("form.user")} placeholder={t("form.user")} value={f.user_id} onChange={(v) => setF({ ...f, user_id: v })} options={dir.reps.map((r) => ({ value: r.id, label: r.name }))} renderOption={personOption} renderValue={personOption} status={touched && !f.user_id ? "error" : undefined} />
        ) : null}
        {f.scope === "territory" ? (
          <Select aria-label={t("form.territory")} placeholder={t("form.territory")} value={f.territory_id} onChange={(v) => setF({ ...f, territory_id: v })} options={dir.territories.map((r) => ({ value: r.id, label: r.name }))} status={touched && !f.territory_id ? "error" : undefined} />
        ) : null}
        <Select aria-label={t("form.metric")} value={f.metric} onChange={(v) => setF({ ...f, metric: v as TargetForm["metric"] })} options={METRICS.map((m) => ({ value: m, label: t(`metric.${m}` as Key) }))} />
        <Layout.Grid idealColumns={2}>
          <InputText type="date" label={t("form.start")} value={f.period_start} onChange={(e) => setF({ ...f, period_start: e.target.value })} />
          <InputText type="date" label={t("form.end")} value={f.period_end} onChange={(e) => setF({ ...f, period_end: e.target.value })} isError={touched && problems.includes("v.period")} />
        </Layout.Grid>
        <InputNumber label={f.metric === "revenue" ? t("form.valueEur") : t("form.value")} value={f.value} min={0} onChange={(v) => setF({ ...f, value: v })} isError={touched && problems.includes("v.value")} />
        {touched && problems.length ? <Notice size="compact" variant="warning" items={problems.map((p) => t(p))} /> : null}
        {err ? <Notice size="compact" variant="warning" description={err} /> : null}
      </Layout.Stack>
    </Modal>
  );
}
