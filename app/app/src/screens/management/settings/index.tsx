import { ShieldCheckIcon } from "@phosphor-icons/react";
import { Alert, Badge, Button, Card, Icon, InputNumber, InputText, Layout, Page, Select, Tabs, Tag, Text, Toggle } from "@wonderful/ui-base";
import { useEffect, useState } from "react";
import { useScreenI18n, type MessageKey } from "../../../lib/i18n";
import type { ScreenProps } from "../../../lib/screenRegistry";
import { LoadView, RichRow } from "./KitView";
import { errorText, humanize, useLoad } from "./kit";
import messages from "./i18n";
import {
  changeCount, diffSettings, icpCategories, icpCriteria, MODES, orgFieldsPresent, parseSettings, permissionMatrix, setIcpWeight,
  setMode, validateSettings, type DiscountPolicy, type Mode, type OrgField, type Settings, type SettingsProblem,
} from "./model";

type T = ReturnType<typeof useScreenI18n<keyof (typeof messages)["en"]>>["t"];

export default function SettingsScreen({ client, navigate }: ScreenProps) {
  const { t } = useScreenI18n(messages);
  const state = useLoad(async () => parseSettings(await client.call("settings-get", {})), [client]);
  return (
    <Page width="medium">
      <Page.Header
        title={t("screen.management.settings")}
        description={t("subtitle")}
        actions={<Button variant="tertiary" prefix={<Icon icon={ShieldCheckIcon} />} onClick={() => navigate("/mgmt/settings/gdpr")}>{t("gdpr")}</Button>}
      />
      <LoadView state={state} onRetry={state.reload} retryLabel={t("retry")} errorTitle={t("common.error")} rows={6}>
        {(s) => <SettingsEditor initial={s} save={(d) => client.call("settings-update", d)} onSaved={state.reload} />}
      </LoadView>
    </Page>
  );
}

function SettingsEditor(p: { initial: Settings; save: (d: ReturnType<typeof diffSettings>) => Promise<unknown>; onSaved: () => void }) {
  const { t } = useScreenI18n(messages);
  const [s, setS] = useState<Settings>(p.initial);
  const [tab, setTab] = useState("ai");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => setS(p.initial), [p.initial]);
  const diff = diffSettings(p.initial, s);
  const n = changeCount(diff);
  const problems = validateSettings(s);
  const bad = (area: SettingsProblem["area"], key: string) => problems.some((x) => x.area === area && x.key === key);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await p.save(diff);
      setSaved(true);
      p.onSaved();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const update = (next: Settings) => { setSaved(false); setS(next); };

  return (
    <>
      <Page.Section>
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { value: "ai", label: t("tab.ai"), content: <AiTab s={s} t={t} onChange={update} /> },
            { value: "org", label: t("tab.org"), content: <OrgTab s={s} t={t} bad={(k) => bad("org", k)} onChange={update} /> },
            { value: "alerts", label: t("tab.alerts"), content: <AlertsTab s={s} t={t} bad={(k) => bad("alerts", k)} onChange={update} /> },
            { value: "icp", label: t("tab.icp"), content: <IcpTab s={s} t={t} onChange={update} /> },
            { value: "discounts", label: t("tab.discounts"), content: <DiscountsTab s={s} t={t} bad={(k) => bad("discounts", k)} onChange={update} /> },
          ]}
        />
      </Page.Section>
      <Page.Footer sticky>
        <Layout.Stack gap="sm">
          {saved && n === 0 ? <Alert variant="success" size="compact" title={t("saved")} /> : null}
          {problems.length ? <Alert variant="warning" size="compact" title={t("invalid")} /> : null}
          {error ? <Alert variant="error" size="compact" title={t("common.error")} description={error} /> : null}
          <Layout.Row split>
            <Text variant="sm" color="secondary">{n ? t("changes", { n }) : t("noChanges")}</Text>
            <Layout.Row gap="sm">
              <Button variant="tertiary" disabled={!n} onClick={() => setS(p.initial)}>{t("discard")}</Button>
              <Button variant="primary" disabled={!n || problems.length > 0} loading={busy} onClick={() => void submit()}>{t("save")}</Button>
            </Layout.Row>
          </Layout.Row>
        </Layout.Stack>
      </Page.Footer>
    </>
  );
}

function AiTab({ s, t, onChange }: { s: Settings; t: T; onChange: (s: Settings) => void }) {
  const m = permissionMatrix(s.ai_permissions);
  const opts = MODES.map((x) => ({ value: x, label: t(`mode.${x}`) }));
  if (!m.actions.length) return <Text variant="sm" color="secondary">{t("noPerms")}</Text>;
  return (
    <Card>
      <Card.Header title={t("tab.ai")} description={t("aiHint")} />
      <Card.List>
        {m.actions.map((a) => (
          <RichRow
            key={a}
            title={humanize(a)}
            description={
              <Layout.Row gap="sm" wrap>
                {m.roles.map((r) => {
                  const cur = m.mode(r, a);
                  return (
                    <Layout.Row key={r} gap="xs">
                      <Text variant="sm" color="secondary">{t(`role.${r}` as MessageKey)}</Text>
                      <Select<Mode>
                        size="small"
                        aria-label={`${humanize(a)} ${r}`}
                        options={opts}
                        value={cur ?? undefined}
                        placeholder="—"
                        status={cur === "never" ? "warning" : undefined}
                        onChange={(v) => onChange({ ...s, ai_permissions: setMode(s.ai_permissions, r, a, v) })}
                      />
                    </Layout.Row>
                  );
                })}
              </Layout.Row>
            }
          />
        ))}
      </Card.List>
    </Card>
  );
}

function OrgTab({ s, t, bad, onChange }: { s: Settings; t: T; bad: (k: string) => boolean; onChange: (s: Settings) => void }) {
  const o = s.organization;
  const set = (k: OrgField, v: unknown) => onChange({ ...s, organization: { ...o, [k]: v } });
  return (
    <Card>
      <Card.Content>
        <Layout.Grid idealColumns={2} gap="md">
          {orgFieldsPresent(o).map((k) => {
            const label = t(`org.${k}`);
            const v = o[k];
            if (typeof v === "boolean") return <Toggle key={k} isChecked={v} onChange={(x) => set(k, x)}>{label}</Toggle>;
            if (k === "default_language")
              return (
                <Layout.Stack key={k} gap="xs">
                  <Text variant="sm" color="secondary">{label}</Text>
                  <Select<string> options={[{ value: "el", label: "Ελληνικά" }, { value: "en", label: "English" }]} value={String(v ?? "el")} onChange={(x) => set(k, x)} />
                </Layout.Stack>
              );
            if (typeof v === "number" || v === null)
              return <InputNumber key={k} label={label} value={v as number | null} isError={bad(k)} min={0} onChange={(x) => set(k, x)} />;
            return <InputText key={k} label={label} value={String(v ?? "")} isError={bad(k)} type={k === "briefing_time" ? "time" : "text"} onChange={(e) => set(k, e.target.value)} />;
          })}
        </Layout.Grid>
      </Card.Content>
    </Card>
  );
}

function AlertsTab({ s, t, bad, onChange }: { s: Settings; t: T; bad: (k: string) => boolean; onChange: (s: Settings) => void }) {
  if (!s.alert_rules.length) return <Text variant="sm" color="secondary">{t("noRules")}</Text>;
  const set = (code: string, patch: object) =>
    onChange({ ...s, alert_rules: s.alert_rules.map((r) => (r.alert_type_code === code ? { ...r, ...patch } : r)) });
  return (
    <Card>
      <Card.Header title={t("tab.alerts")} description={t("alertsHint")} />
      <Card.List>
        {s.alert_rules.map((r) => (
          <RichRow
            key={r.alert_type_code}
            title={humanize(r.alert_type_code)}
            description={
              <Layout.Row gap="sm" wrap>
                <InputNumber aria-label={t("threshold")} prefix={t("threshold")} value={r.threshold_value} isError={bad(r.alert_type_code)} width={180} onChange={(v) => set(r.alert_type_code, { threshold_value: v })} />
                <InputNumber aria-label={t("window")} prefix={t("window")} value={r.window_days} width={200} min={0} onChange={(v) => set(r.alert_type_code, { window_days: v })} />
              </Layout.Row>
            }
            actions={<Toggle aria-label={t("enabled")} isChecked={r.enabled} onChange={(v) => set(r.alert_type_code, { enabled: v })} />}
          />
        ))}
      </Card.List>
    </Card>
  );
}

function IcpTab({ s, t, onChange }: { s: Settings; t: T; onChange: (s: Settings) => void }) {
  const crit = icpCriteria(s.icp);
  const cats = icpCategories(s.icp);
  const min = s.organization.icp_min_score;
  return (
    <Card>
      <Card.Header title={t("tab.icp")} description={t("icpHint")} actions={typeof min === "number" ? <Badge text={`${t("org.icp_min_score")}: ${min}`} color="blue" size="small" /> : null} />
      <Card.Content>
        <Layout.Stack gap="md">
          {crit.length === 0 && cats.length === 0 ? <Text variant="sm" color="secondary">{t("noIcp")}</Text> : null}
          {crit.map((c) => (
            <InputNumber key={c.criterion} label={humanize(c.criterion)} suffix={t("weight")} value={c.weight} min={0} max={10} width={220}
              onChange={(v) => onChange({ ...s, icp: setIcpWeight(s.icp, c.criterion, v ?? 0) })} />
          ))}
          {cats.length ? (
            <Layout.Stack gap="xs">
              <Text variant="sm" color="secondary">{t("icpCategories")}</Text>
              <Layout.Row gap="xs" wrap>{cats.map((c) => <Tag key={c} text={c} color="blue" />)}</Layout.Row>
            </Layout.Stack>
          ) : null}
        </Layout.Stack>
      </Card.Content>
    </Card>
  );
}

function scopeText(p: DiscountPolicy, t: T): string {
  const parts: string[] = [];
  if (p.role_code) parts.push(t("scope.role", { role: t(`role.${p.role_code}` as MessageKey) }));
  if (p.user_id) parts.push(t("scope.user"));
  if (p.product_category_id) parts.push(t("scope.product"));
  if (p.account_category_id) parts.push(t("scope.account"));
  return `${t("scope")}: ${parts.length ? parts.join(", ") : t("scope.all")}`;
}

function DiscountsTab({ s, t, bad, onChange }: { s: Settings; t: T; bad: (k: string) => boolean; onChange: (s: Settings) => void }) {
  if (!s.discount_policies.length) return <Text variant="sm" color="secondary">{t("noPolicies")}</Text>;
  const set = (i: number, patch: Partial<DiscountPolicy>) =>
    onChange({ ...s, discount_policies: s.discount_policies.map((p, j) => (j === i ? { ...p, ...patch } : p)) });
  return (
    <Card>
      <Card.Header title={t("tab.discounts")} description={t("discountsHint")} />
      <Card.List>
        {s.discount_policies.map((p, i) => (
          <RichRow
            key={p.id ?? i}
            title={scopeText(p, t)}
            description={<InputNumber aria-label={t("maxPct")} prefix={t("maxPct")} value={p.max_discount_pct} min={0} max={100} step={0.5} width={160} isError={bad(String(i))} onChange={(v) => set(i, { max_discount_pct: v ?? 0 })} />}
            actions={<Toggle aria-label={t("active")} isChecked={p.active} onChange={(v) => set(i, { active: v })}>{t("active")}</Toggle>}
          />
        ))}
      </Card.List>
    </Card>
  );
}
