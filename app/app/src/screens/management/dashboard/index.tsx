import { Badge, Button, Card, Icon, Layout, Modal, Page, Progress, Select, Text, ToggleGroup, Tooltip } from "@wonderful/ui-base";
import { ArrowsClockwiseIcon, CaretRightIcon } from "@phosphor-icons/react";
import { useState } from "react";
import type { DashboardKpisResponse, KpiSet, TargetProgress, TargetsListResponse } from "../../../contracts";
import { seedRows } from "../../../contracts";
import type { MercClient } from "../../../lib/client";
import { screenTitleKey, useScreenI18n, type Lang } from "../../../lib/i18n";
import type { ScreenProps } from "../../../lib/screenRegistry";
import messages from "./i18n";
import {
  baselineDelta,
  deltaLabel,
  drillRow,
  formatValue,
  kpiRequest,
  paceColor,
  REP_COLUMNS,
  repCell,
  stageBars,
  targetFigures,
  targetPace,
  tileValue,
  TILE_GROUPS,
  type DrillKpi,
  type TileDef,
} from "./logic";
import { useDirectory, type Directory } from "./shared/directory";
import { date, money, num } from "./shared/format";
import { monthRange, PERIOD_PRESETS, periodRange, type Period, type PeriodPreset } from "./shared/period";
import { BarButton } from "./shared/BarButton";
import { Region } from "./shared/Region";
import { useAsync } from "./shared/useAsync";

type Key = keyof typeof messages.en;
type T = ReturnType<typeof useScreenI18n<Key>>["t"];
const kpiKey = (k: string) => `kpi.${k}` as Key;

/** Stage order from the deal_stage lookup (contracts seed; lookups are part of the contract). */
export const STAGE_ORDER: readonly string[] = seedRows("deal_stage")
  .sort((a, b) => Number(a.sort_order) - Number(b.sort_order))
  .map((r) => String(r.code));

/** A record drill-down (kpi-drilldown): the KPI and the tile (label) it was opened from. */
type Drill = { kpi: DrillKpi; tile: string };

/** Management dashboard (REQ-DSH-001/002, REQ-TGT-002, REQ-DSH-004): KPI set by period/scope/territory/rep, drill-down, targets. */
export default function Dashboard({ screen, client, lang }: ScreenProps) {
  const { t } = useScreenI18n(messages);
  const [preset, setPreset] = useState<PeriodPreset>("month");
  const [scope, setScope] = useState<"team" | "org">("team");
  const [territoryId, setTerritoryId] = useState<string | null>(null);
  const [repId, setRepId] = useState<string | null>(null);
  const [drill, setDrill] = useState<Drill | null>(null);
  const period = periodRange(preset);
  const filters = { scope, ...period, territoryId, repId };
  const key = JSON.stringify(filters);

  const kpis = useAsync(() => client.call("dashboard-kpis", kpiRequest(filters)), key);
  const month = monthRange(0);
  const targets = useAsync(
    () => client.call("targets-list", repId ? { period_start: month.from, rep_id: repId } : { period_start: month.from }),
    `${month.from}|${repId ?? ""}`,
  );
  const dir = useDirectory(client, screen.functions);
  const reps = kpis.data?.by_rep.map((r) => r.rep) ?? [];

  return (
    <>
      <Page width="full">
        <Page.Header
          title={t(screenTitleKey(screen.shell, screen.key))}
          description={t("subtitle")}
          actions={
            <Layout.Row gap="xs" wrap>
              <Tooltip content={t("retry")}>
                <Button
                  size="small"
                  variant="tertiary"
                  aria-label={t("retry")}
                  prefix={<Icon icon={ArrowsClockwiseIcon} />}
                  onClick={() => {
                    kpis.reload();
                    targets.reload();
                  }}
                />
              </Tooltip>
            </Layout.Row>
          }
        />
        <Page.Toolbar>
          <Layout.Row gap="sm" wrap>
            {client.mock ? <Badge text={t("mock.note")} color="purple" size="small" /> : null}
            <ToggleGroup value={scope} onChange={(v) => setScope(v as "team" | "org")} size="small" aria-label={t("scope.team")}>
              <ToggleGroup.Item value="team" text={t("scope.team")} />
              <ToggleGroup.Item value="org" text={t("scope.org")} />
            </ToggleGroup>
            <Select
              size="small"
              aria-label="period"
              value={preset}
              onChange={(v) => setPreset(v as PeriodPreset)}
              options={PERIOD_PRESETS.map((p) => ({ value: p, label: t(`period.${p}`) }))}
            />
            <Select
              size="small"
              aria-label={t("filter.territory")}
              value={territoryId ?? ""}
              onChange={(v) => setTerritoryId(v || null)}
              options={[{ value: "", label: `${t("filter.territory")}: ${t("filter.all")}` }, ...dir.territories.map((x) => ({ value: x.id, label: x.name }))]}
            />
            <Select
              size="small"
              aria-label={t("filter.rep")}
              value={repId ?? ""}
              onChange={(v) => setRepId(v || null)}
              options={[{ value: "", label: `${t("filter.rep")}: ${t("filter.all")}` }, ...uniqueReps(reps, repId, dir).map((r) => ({ value: r.id, label: r.name }))]}
            />
          </Layout.Row>
        </Page.Toolbar>
        <Page.Section>
          <Region state={kpis} t={t} rows={8}>
            {(d) => <DashboardView data={d} lang={lang} t={t} onDrill={(kpi, tile) => setDrill({ kpi, tile })} onRep={setRepId} />}
          </Region>
        </Page.Section>
        <Page.Section>
          <Card>
            <Card.Header title={t("section.targets")} />
            <Card.Content>
              <Region state={targets} t={t} rows={3} isEmpty={(d) => d.items.length === 0} emptyTitle={t("targets.empty")}>
                {(d: TargetsListResponse) => <TargetBars items={d.items} lang={lang} t={t} />}
              </Region>
            </Card.Content>
          </Card>
        </Page.Section>
      </Page>
      {drill ? <DrillModal drill={drill} dir={dir} client={client} period={period} territoryId={territoryId} repId={repId} lang={lang} t={t} onClose={() => setDrill(null)} /> : null}
    </>
  );
}

function uniqueReps(reps: { id: string; full_name: string }[], selected: string | null, dir: Directory) {
  const out = new Map(reps.map((r) => [r.id, r.full_name]));
  if (selected && !out.has(selected)) out.set(selected, dir.name("user", selected) ?? selected.slice(0, 8));
  return [...out].map(([id, name]) => ({ id, name }));
}

/** Pure view of one dashboard-kpis response (tested with SSR). */
export function DashboardView(props: { data: DashboardKpisResponse; lang: Lang; t: T; onDrill: (kpi: DrillKpi, tile: string) => void; onRep: (id: string) => void }) {
  const { data, lang, t } = props;
  const k = data.kpis;
  return (
    <Layout.Stack gap="lg">
      {TILE_GROUPS.map((g) => (
        <Layout.Stack gap="sm" key={g.key}>
          <Text variant="heading-4">{t(`section.${g.key}`)}</Text>
          <Layout.Grid idealColumns={4}>
            {g.tiles.map((tile) => (
              <KpiTile key={tile.key} k={k} tile={tile} lang={lang} t={t} onDrill={props.onDrill} />
            ))}
          </Layout.Grid>
        </Layout.Stack>
      ))}
      <Layout.Grid idealColumns={2}>
        <PipelineCard k={k} lang={lang} t={t} onDrill={props.onDrill} />
        <RepsCard data={data} lang={lang} t={t} onRep={props.onRep} />
      </Layout.Grid>
    </Layout.Stack>
  );
}

function KpiTile(props: { k: KpiSet; tile: TileDef; lang: Lang; t: T; onDrill: (kpi: DrillKpi, tile: string) => void }) {
  const { k, tile, lang, t } = props;
  const d = baselineDelta(k, tile);
  const title = t(kpiKey(tile.key));
  return (
    <Card>
      <Card.Header
        title={title}
        actions={
          <Tooltip content={t("drill.open")}>
            <Button
              size="small"
              variant="tertiary"
              aria-label={`${t("drill.open")}: ${title}`}
              data-drill={tile.drill}
              prefix={<Icon icon={CaretRightIcon} />}
              onClick={() => props.onDrill(tile.drill, tile.key)}
            />
          </Tooltip>
        }
      />
      <Card.Stat value={tileValue(k, tile, lang)}>
        {d ? <Card.Stat.Delta value={deltaLabel(d, tile, lang)} direction={d.direction} label={t("baseline.before", { v: formatValue(d.before, tile.format, lang) })} /> : null}
      </Card.Stat>
    </Card>
  );
}

function PipelineCard(props: { k: KpiSet; lang: Lang; t: T; onDrill: (kpi: DrillKpi, tile: string) => void }) {
  const { k, lang, t } = props;
  const bars = stageBars(k, STAGE_ORDER);
  return (
    <Card>
      <Card.Header
        title={t("section.pipeline")}
        description={`${t("kpi.weighted_pipeline_minor")}: ${money(k.weighted_pipeline_minor, lang)}`}
        actions={
          <Layout.Row gap="xs" wrap>
            <Button size="small" variant="tertiary" data-drill="stuck_deals" onClick={() => props.onDrill("stuck_deals", "stuck")}>
              {t("stuck.open")}
            </Button>
          </Layout.Row>
        }
      />
      <Card.Content>
        {bars.length === 0 ? (
          <Text variant="body-sm" color="secondary">
            {t("pipeline.empty")}
          </Text>
        ) : (
          <Layout.Stack gap="sm">
            {bars.map((b) => (
              <BarButton key={b.stage_code} label={`${t("drill.open")}: ${b.stage_code}`} onClick={() => props.onDrill("pipeline", "weighted_pipeline_minor")}>
                <Layout.Row split>
                  <Text variant="body-sm">{b.stage_code}</Text>
                  <Text variant="body-sm" color="secondary">
                    {money(b.amount_minor, lang, true)} · {t("pipeline.count", { n: b.count })}
                  </Text>
                </Layout.Row>
                <Progress value={b.share} showInfo={false} size="small" />
              </BarButton>
            ))}
          </Layout.Stack>
        )}
      </Card.Content>
    </Card>
  );
}

function RepsCard(props: { data: DashboardKpisResponse; lang: Lang; t: T; onRep: (id: string) => void }) {
  const { data, lang, t } = props;
  return (
    <Card>
      <Card.Header title={t("section.reps")} />
      {data.by_rep.length === 0 ? (
        <Card.Content>
          <Text variant="body-sm" color="secondary">
            {t("reps.empty")}
          </Text>
        </Card.Content>
      ) : (
        <Card.List>
          {data.by_rep.map((r) => (
            <Card.Meta
              key={r.rep.id}
              title={r.rep.full_name}
              description={REP_COLUMNS.map((c) => `${t(kpiKey(c.key))} ${repCell(r.kpis, c, lang)}`).join(" · ")}
              actions={
                <Tooltip content={t("reps.filter")}>
                  <Button size="small" variant="tertiary" aria-label={`${t("reps.filter")}: ${r.rep.full_name}`} prefix={<Icon icon={CaretRightIcon} />} onClick={() => props.onRep(r.rep.id)} />
                </Tooltip>
              }
            />
          ))}
        </Card.List>
      )}
    </Card>
  );
}

export function TargetBars(props: { items: readonly TargetProgress[]; lang: Lang; t: T }) {
  const { lang, t } = props;
  return (
    <Layout.Stack gap="md">
      {props.items.map((x) => {
        const f = targetFigures(x, lang);
        return (
          <Layout.Stack gap="xs" key={x.target_id}>
            <Layout.Row split>
              <Text variant="body-sm">{t(`metric.${x.metric}`)}</Text>
              <Text variant="body-sm" color="secondary">
                {t("targets.of", { a: f.actual, b: f.target })} · {t("targets.days", { n: x.days_left })}
              </Text>
            </Layout.Row>
            <Progress value={Math.min(100, Math.max(0, x.pct))} color={paceColor(targetPace(x))} />
          </Layout.Stack>
        );
      })}
    </Layout.Stack>
  );
}

function DrillModal(props: { drill: Drill; dir: Directory; client: MercClient; period: Period; territoryId: string | null; repId: string | null; lang: Lang; t: T; onClose: () => void }) {
  const { drill, client, period, lang, t } = props;
  const [limit, setLimit] = useState(20);
  const dir = props.dir;
  const req = {
    kpi: drill.kpi,
    from: period.from,
    to: period.to,
    page: 1,
    limit,
    ...(props.territoryId ? { territory_id: props.territoryId } : {}),
    ...(props.repId ? { rep_id: props.repId } : {}),
  };
  const state = useAsync(() => client.call("kpi-drilldown", req), JSON.stringify(req));
  const title = drill.tile === "stuck" ? t("section.stuck") : t(kpiKey(drill.tile));
  return (
    <Modal
      open
      onClose={props.onClose}
      title={t("drill.title", { kpi: title })}
      description={state.data ? t("drill.subtitle", { n: num(state.data.page.total, lang, 0), from: date(period.from, lang), to: date(period.to, lang) }) : undefined}
      footer={
        <Modal.Footer>
          {state.data && state.data.items.length < state.data.page.total ? (
            <Button variant="secondary" onClick={() => setLimit((n) => n + 20)}>
              {t("drill.more")}
            </Button>
          ) : null}
          <Button variant="primary" onClick={props.onClose}>
            {t("drill.close")}
          </Button>
        </Modal.Footer>
      }
    >
      <Region state={state} t={t} isEmpty={(d) => d.items.length === 0} emptyTitle={t("drill.empty")}>
        {(d) => (
          <Card>
            <Card.List>
              {d.items.map((row) => {
                const r = drillRow(row, lang, (kind, id) => dir.name(kind, id));
                return <Card.Meta key={r.id} title={r.title} description={r.description} />;
              })}
            </Card.List>
          </Card>
        )}
      </Region>
    </Modal>
  );
}
