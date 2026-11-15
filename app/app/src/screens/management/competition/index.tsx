import { Badge, Button, Card, Icon, Layout, Page, Progress, Select, Text, Tooltip } from "@wonderful/ui-base";
import { ArrowsClockwiseIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { screenTitleKey, useScreenI18n, type Lang } from "../../../lib/i18n";
import type { ScreenProps } from "../../../lib/screenRegistry";
import { useDirectory } from "../dashboard/shared/directory";
import { date, num } from "../dashboard/shared/format";
import { BarButton } from "../dashboard/shared/BarButton";
import { Region } from "../dashboard/shared/Region";
import { useAsync, type AsyncState } from "../dashboard/shared/useAsync";
import messages from "./i18n";
import { applyFilters, byCompetitor, byTerritory, listRequest, newestFirst, SINCE, toSignal, type Bucket, type Signal, type Since } from "./logic";

type Key = keyof typeof messages.en;
type T = ReturnType<typeof useScreenI18n<Key>>["t"];

const deltaText = (d: number | null, lang: Lang): string | null => (d === null ? null : `${d > 0 ? "+" : d < 0 ? "−" : ""}${num(Math.abs(d), lang, 1)}%`);

/** Competition view (REQ-DSH-006): competitor signals by competitor, territory and time. */
export default function Competition({ screen, client, lang }: ScreenProps) {
  const { t } = useScreenI18n(messages);
  const [competitorId, setCompetitorId] = useState<string | null>(null);
  const [territoryId, setTerritoryId] = useState<string | null>(null);
  const [since, setSince] = useState<Since>(90);
  const filters = { competitorId, territoryId, since };
  const req = listRequest(filters);
  const dir = useDirectory(client, screen.functions);
  const rows = useAsync(async () => (await client.call("competitor-signals-list", req)).items, JSON.stringify(req));
  // Label after fetching, so the live team/territory names apply without refetching the signals.
  const state = { ...rows, data: rows.data?.map((r) => toSignal(r, dir)) } as AsyncState<Signal[]> & { reload: () => void };

  return (
    <Page width="full">
      <Page.Header
        title={t(screenTitleKey(screen.shell, screen.key))}
        description={t("subtitle")}
        actions={
          <Layout.Row gap="xs" wrap>
            <Tooltip content={t("retry")}>
              <Button size="small" variant="tertiary" aria-label={t("retry")} prefix={<Icon icon={ArrowsClockwiseIcon} />} onClick={state.reload} />
            </Tooltip>
          </Layout.Row>
        }
      />
      <Page.Toolbar>
        <Layout.Row gap="sm" wrap>
          {client.mock ? <Badge text={t("mock.note")} color="purple" size="small" /> : null}
          <Select
            size="small"
            aria-label={t("filter.competitor")}
            value={competitorId ?? ""}
            onChange={(v) => setCompetitorId(v || null)}
            options={[{ value: "", label: `${t("filter.competitor")}: ${t("filter.all")}` }, ...dir.competitors.map((c) => ({ value: c.id, label: c.name }))]}
          />
          <Select
            size="small"
            aria-label={t("filter.territory")}
            value={territoryId ?? ""}
            onChange={(v) => setTerritoryId(v || null)}
            options={[{ value: "", label: `${t("filter.territory")}: ${t("filter.all")}` }, ...dir.territories.map((c) => ({ value: c.id, label: c.name }))]}
          />
          <Select
            size="small"
            aria-label="since"
            value={String(since)}
            onChange={(v) => setSince(v === "null" ? null : (Number(v) as Since))}
            options={SINCE.map((s) => ({ value: String(s), label: t(`since.${s ?? "all"}` as Key) }))}
          />
        </Layout.Row>
      </Page.Toolbar>
      <Page.Section>
        <Region state={state} t={t} rows={6} isEmpty={(d) => applyFilters(d, filters).length === 0} emptyTitle={t("empty")} emptyBody={t("emptyBody")}>
          {(d) => <CompetitionView signals={applyFilters(d, filters)} lang={lang} t={t} onCompetitor={setCompetitorId} onTerritory={setTerritoryId} />}
        </Region>
      </Page.Section>
    </Page>
  );
}

/** Pure view (tested with SSR): two breakdowns, then the signal list newest first. */
export function CompetitionView(props: { signals: readonly Signal[]; lang: Lang; t: T; onCompetitor: (id: string) => void; onTerritory: (id: string | null) => void }) {
  const { signals, lang, t } = props;
  return (
    <Layout.Stack gap="lg">
      <Layout.Grid idealColumns={2}>
        <BucketCard title={t("summary.competitors")} buckets={byCompetitor(signals)} lang={lang} t={t} onPick={(id) => props.onCompetitor(id)} />
        <BucketCard title={t("summary.territories")} buckets={byTerritory(signals, t("list.noTerritory"))} lang={lang} t={t} onPick={(id) => props.onTerritory(id === "-" ? null : id)} />
      </Layout.Grid>
      <Card>
        <Card.Header title={t("list.title")} description={t("summary.signals", { n: signals.length })} />
        <Card.List>
          {newestFirst(signals).map((x) => (
            <Card.Meta
              key={x.id}
              title={x.statement || x.competitor}
              description={[x.account, x.territory, t("list.reported", { who: x.reporter ?? "—", when: date(x.observed_at, lang) })].filter(Boolean).join(" · ")}
              actions={
                <Layout.Row gap="xs">
                  <Badge text={x.competitor} size="small" variant="outlined" />
                  {x.price_delta_pct !== null ? <Badge text={t("list.delta", { d: deltaText(x.price_delta_pct, lang)! })} color={x.price_delta_pct < 0 ? "red" : "neutral"} size="small" /> : null}
                </Layout.Row>
              }
            />
          ))}
        </Card.List>
      </Card>
    </Layout.Stack>
  );
}

function BucketCard(props: { title: string; buckets: Bucket[]; lang: Lang; t: T; onPick: (id: string) => void }) {
  const { lang, t } = props;
  return (
    <Card>
      <Card.Header title={props.title} />
      <Card.Content>
        <Layout.Stack gap="sm">
          {props.buckets.map((b) => (
            <BarButton key={b.id} label={b.name} data-bucket={b.name} onClick={() => props.onPick(b.id)}>
              <Layout.Row split>
                <Text variant="body-sm">{b.name}</Text>
                <Text variant="body-sm" color="secondary">
                  {[t("summary.signals", { n: b.count }), b.avgDelta !== null ? t("summary.delta", { d: deltaText(b.avgDelta, lang)! }) : null].filter(Boolean).join(" · ")}
                </Text>
              </Layout.Row>
              <Progress value={b.share} showInfo={false} size="small" />
            </BarButton>
          ))}
        </Layout.Stack>
      </Card.Content>
    </Card>
  );
}
