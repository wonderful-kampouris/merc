import { Badge, Card, EmptyState, Layout, Page, Select, Skeleton, Text } from "@wonderful/ui-base";
import { useCallback, useEffect, useState } from "react";
import type { AlertCard, UserRef, VisitSummary } from "../../../contracts";
import { useScreenI18n } from "../../../lib/i18n";
import type { ScreenProps } from "../../../lib/screenRegistry";
import RepAvatar, { personOption } from "../../../shell/RepAvatar";
import { AssignTask, AssignVisit } from "./AssignForms";
import messages from "./i18n";
import { accountOptions, detailRange, humanize, isoDay, kpiEntries, rosterFromTeam, sortAlerts, teamRoster, type RepDetail } from "./logic";

type T = (key: string, vars?: Record<string, string | number>) => string;
type Async<V> = { state: "loading" } | { state: "error"; message: string } | { state: "ready"; value: V };

const SEV_COLOR = { high: "red", medium: "orange", low: "muted" } as const;
const VISIT_COLOR = { planned: "blue", done: "green", skipped: "muted" } as const;
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

function AlertRow({ a, t }: { a: AlertCard; t: T }) {
  return (
    <Card.Meta
      title={a.message}
      description={[a.account?.name, a.suggested_action].filter(Boolean).join(" · ") || undefined}
      truncateDescription={false}
      actions={<Badge text={t(`sev_${a.severity}`)} color={SEV_COLOR[a.severity]} size="small" />}
    />
  );
}

function VisitRow({ v, t }: { v: VisitSummary; t: T }) {
  return (
    <Card.Meta
      title={v.account.name}
      description={[v.planned_date, v.purpose].filter(Boolean).join(" · ")}
      actions={<Badge text={t(`visit_${v.status}`)} color={VISIT_COLOR[v.status]} size="small" />}
    />
  );
}

function LoadingCard() {
  return (
    <Card>
      <Card.Content>
        <Layout.Stack gap="sm">
          <Skeleton width="50%" height={20} />
          <Skeleton.Text rows={3} />
        </Layout.Stack>
      </Card.Content>
    </Card>
  );
}

/** Management Team (REQ-PLN-004): pick a rep, see the last 14 days, assign a visit or a task. */
export default function Team({ client, lang }: ScreenProps) {
  const { t: rawT } = useScreenI18n(messages);
  const t = rawT as T;
  const [team, setTeam] = useState<Async<{ reps: UserRef[]; fallback?: string }>>({ state: "loading" });
  const [repId, setRepId] = useState<string | null>(null);
  const [alerts, setAlerts] = useState<Async<AlertCard[]>>({ state: "loading" });
  const [detail, setDetail] = useState<Async<RepDetail>>({ state: "loading" });
  const today = isoDay(new Date());

  // The roster comes from fn:team-list (REQ-PLN-004); on failure the seed roster keeps the forms usable.
  const loadTeam = useCallback(async () => {
    setTeam({ state: "loading" });
    let value: { reps: UserRef[]; fallback?: string };
    try {
      value = { reps: rosterFromTeam((await client.call("team-list", {})).items) };
    } catch (e) {
      value = { reps: teamRoster(), fallback: message(e) };
    }
    setTeam({ state: "ready", value });
    setRepId((cur) => (cur && value.reps.some((r) => r.id === cur) ? cur : value.reps[0]?.id ?? null));
  }, [client]);

  const loadAlerts = useCallback(async () => {
    setAlerts({ state: "loading" });
    try {
      const res = await client.call("alerts-list", { status: "open", scope: "team", limit: 20 });
      setAlerts({ state: "ready", value: sortAlerts(res.items) });
    } catch (e) {
      setAlerts({ state: "error", message: message(e) });
    }
  }, [client]);

  const loadDetail = useCallback(async () => {
    if (!repId) return;
    setDetail({ state: "loading" });
    try {
      const value = await client.call("rep-detail", { rep_id: repId, ...detailRange() });
      setDetail({ state: "ready", value });
    } catch (e) {
      setDetail({ state: "error", message: message(e) });
    }
  }, [client, repId]);

  useEffect(() => void loadTeam(), [loadTeam]);
  useEffect(() => void loadAlerts(), [loadAlerts]);
  useEffect(() => void loadDetail(), [loadDetail]);

  const roster = team.state === "ready" ? team.value.reps : [];
  const rep = roster.find((r) => r.id === repId) ?? null;
  const d = detail.state === "ready" ? detail.value : null;
  const accounts = accountOptions(d, alerts.state === "ready" ? alerts.value : []);
  const kpiLabel = (k: string) => {
    const key = `kpi_${k}`;
    const s = t(key);
    return s === key ? humanize(k) : s;
  };
  const num = new Intl.NumberFormat(lang === "el" ? "el-GR" : "en-GB", { maximumFractionDigits: 1 });

  return (
    <Page width="medium">
      <Page.Header
        title={t("screen.management.team")}
        description={t("subtitle")}
        actions={client.mock ? <Badge text={t("badge.mock")} color="purple" size="small" /> : undefined}
      />
      <Page.Section>
        {team.state === "loading" ? (
          <Skeleton width="40%" height={32} />
        ) : roster.length === 0 ? (
          <EmptyState title={t("no_reps")} actions={[{ label: t("retry"), onClick: () => void loadTeam() }]} />
        ) : (
          <Layout.Stack gap="xs">
            {team.state === "ready" && team.value.fallback ? <Text variant="sm" color="secondary">{t("roster_fallback", { msg: team.value.fallback })}</Text> : null}
            <Text variant="sm" color="secondary">{t("rep_label")}</Text>
            <Select aria-label={t("rep_label")} options={roster.map((r) => ({ value: r.id, label: r.full_name }))} renderOption={personOption} renderValue={personOption} value={repId ?? undefined} onChange={(v) => setRepId(String(v))} />
          </Layout.Stack>
        )}
      </Page.Section>

      {rep ? (
        <Page.Section>
          {detail.state === "loading" ? (
            <LoadingCard />
          ) : detail.state === "error" ? (
            <EmptyState title={t("detail_error")} description={detail.message} actions={[{ label: t("retry"), onClick: () => void loadDetail() }]} />
          ) : (
            <Layout.Stack gap="md">
              <Card>
                <Card.Header icon={<RepAvatar name={d!.rep.full_name} />} title={d!.rep.full_name} description={t("kpis")} />
                <Card.Content>
                  {kpiEntries(d!.kpis).length ? (
                    <Layout.Grid idealColumns={3}>
                      {kpiEntries(d!.kpis).map(({ key, value }) => (
                        <Layout.Stack key={key} gap="none">
                          <Text variant="sm" color="secondary">{kpiLabel(key)}</Text>
                          <Text variant="h3">{typeof value === "number" ? num.format(value) : value}</Text>
                        </Layout.Stack>
                      ))}
                    </Layout.Grid>
                  ) : (
                    <Text variant="sm" color="secondary">{t("kpis_empty")}</Text>
                  )}
                </Card.Content>
              </Card>
              <Card>
                <Card.Header title={t("recent_visits")} actions={<Badge text={String(d!.recent_visits.length)} size="small" />} />
                {d!.recent_visits.length ? (
                  <Card.List>
                    {d!.recent_visits.slice(0, 8).map((v, i) => (
                      <VisitRow key={`${v.visit_id}-${i}`} v={v} t={t} />
                    ))}
                  </Card.List>
                ) : (
                  <Card.Content>
                    <Text variant="sm" color="secondary">{t("visits_empty")}</Text>
                  </Card.Content>
                )}
              </Card>
              <Card>
                <Card.Header title={t("open_alerts")} actions={<Badge text={String(d!.open_alerts.length)} color={d!.open_alerts.length ? "orange" : "muted"} size="small" />} />
                {d!.open_alerts.length ? (
                  <Card.List>
                    {sortAlerts(d!.open_alerts).map((a) => (
                      <AlertRow key={a.alert_id} a={a} t={t} />
                    ))}
                  </Card.List>
                ) : (
                  <Card.Content>
                    <Text variant="sm" color="secondary">{t("open_alerts_empty")}</Text>
                  </Card.Content>
                )}
              </Card>
            </Layout.Stack>
          )}
        </Page.Section>
      ) : null}

      {rep ? (
        <Page.Section>
          <Layout.Grid idealColumns={2}>
            <AssignVisit key={`v-${rep.id}-${accounts[0]?.id ?? ""}`} rep={rep} accounts={accounts} client={client} t={t} today={today} />
            <AssignTask key={`t-${rep.id}`} rep={rep} accounts={accounts} client={client} t={t} />
          </Layout.Grid>
        </Page.Section>
      ) : null}

      <Page.Section>
        <Card>
          <Card.Header title={t("team_alerts")} />
          {alerts.state === "loading" ? (
            <Card.Content>
              <Skeleton.Text rows={3} />
            </Card.Content>
          ) : alerts.state === "error" ? (
            <Card.Content>
              <EmptyState title={t("alerts_error")} description={alerts.message} actions={[{ label: t("retry"), onClick: () => void loadAlerts() }]} />
            </Card.Content>
          ) : alerts.value.length ? (
            <Card.List>
              {alerts.value.map((a) => (
                <AlertRow key={a.alert_id} a={a} t={t} />
              ))}
            </Card.List>
          ) : (
            <Card.Content>
              <Text variant="sm" color="secondary">{t("team_alerts_empty")}</Text>
            </Card.Content>
          )}
        </Card>
      </Page.Section>
    </Page>
  );
}
