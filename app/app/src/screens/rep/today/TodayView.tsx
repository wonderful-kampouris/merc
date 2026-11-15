import { Alert, Badge, Button, Card, EmptyState, Icon, Layout, Page, Progress, Skeleton, Text } from "@wonderful/ui-base";
import { ArrowClockwiseIcon, CalendarBlankIcon, CaretRightIcon, MicrophoneIcon, StorefrontIcon, SunHorizonIcon } from "@phosphor-icons/react";
import { useState } from "react";
import type { VisitSummary } from "../../../contracts";
import { useScreenI18n, type Lang } from "../../../lib/i18n";
import type { LiveMode } from "../../../lib/live";
import type { TodayLoad } from "./loadToday";
import messages from "./i18n";
import { clampPct, formatDay, formatMoney, formatTargetValue, formatTime, sortStops, summarizeStops } from "./todayModel";

export type TodayViewState =
  | { status: "loading" }
  | { status: "error"; reason: string }
  | { status: "ready"; load: TodayLoad; refreshing: boolean };

export interface TodayViewProps {
  state: TodayViewState;
  lang: Lang;
  mock: boolean;
  offlineCapable: boolean;
  live: LiveMode | null;
  now: Date;
  onRetry: () => void;
  onOpenAccount: (accountId: string) => void;
  onRecord: () => void;
  onOpenWeek: () => void;
}

const STATUS_COLOR = { planned: "blue", done: "green", skipped: "muted" } as const;
const LIVE_KEY = { connecting: "live.connecting", socket: "live.socket", polling: "live.polling" } as const;

type T = ReturnType<typeof useScreenI18n<keyof typeof messages.en>>["t"];

function StopRow({ v, index, t, onOpen }: { v: VisitSummary; index: number; t: T; onOpen: () => void }) {
  const pos = v.route_position ?? index + 1;
  const where = [v.account.city, v.account.postal_code].filter(Boolean).join(" · ");
  const why = v.reason ?? v.purpose ?? v.account.reason;
  return (
    <Card.List.Item>
      <Card.Meta
        avatar={
          <Text variant="md" weight="bold" aria-label={t("position", { n: pos })}>
            {pos}
          </Text>
        }
        title={v.account.name}
        description={[why, where].filter(Boolean).join(" — ") || t(v.account.account_type)}
        truncateDescription={false}
        actions={
          <Layout.Row gap="xs">
            <Badge text={t(`status.${v.status}`)} color={STATUS_COLOR[v.status]} size="small" />
            <Button variant="tertiary" size="small" aria-label={t("openCard")} prefix={<Icon icon={CaretRightIcon} />} onClick={onOpen} />
          </Layout.Row>
        }
      />
    </Card.List.Item>
  );
}

function Loading() {
  return (
    <Page.Section>
      <Layout.Stack gap="md" aria-busy="true">
        <Skeleton height={72} radius="lg" />
        <Skeleton height={56} />
        <Skeleton height={56} />
        <Skeleton height={56} />
      </Layout.Stack>
    </Page.Section>
  );
}

/** Presentational Today screen: stops in route order, briefing and week performance; offline banner from cache. */
export default function TodayView(props: TodayViewProps) {
  const { t } = useScreenI18n(messages);
  const { state, lang } = props;
  const [scriptOpen, setScriptOpen] = useState(false);

  const header = (description?: string) => (
    <Page.Header
      title={t("title")}
      description={description}
      actions={
        <Layout.Row gap="xs" wrap>
          {props.mock ? <Badge text={t("badge.mock")} color="purple" size="small" /> : null}
          {state.status === "ready" && state.load.source === "cache" ? <Badge text={t("live.off")} color="orange" size="small" /> : null}
          {props.live && !(state.status === "ready" && state.load.source === "cache") ? (
            <Badge text={t(LIVE_KEY[props.live])} color={props.live === "socket" ? "green" : "neutral"} isDot={props.live === "socket"} size="small" />
          ) : null}
          <Button
            variant="tertiary"
            size="small"
            aria-label={t("refresh")}
            prefix={<Icon icon={ArrowClockwiseIcon} />}
            loading={state.status === "loading" || (state.status === "ready" && state.refreshing)}
            onClick={props.onRetry}
          />
        </Layout.Row>
      }
    />
  );

  if (state.status === "loading") {
    return (
      <Page width="small">
        {header(t("common.loading"))}
        <Loading />
      </Page>
    );
  }

  if (state.status === "error") {
    return (
      <Page width="small">
        {header()}
        <Page.Section>
          <Alert
            variant="error"
            title={t("errorTitle")}
            description={state.reason === "offline" ? t("errorNoCache") : `${t("errorNoCache")} (${state.reason})`}
            action={<Button onClick={props.onRetry}>{t("retry")}</Button>}
          />
        </Page.Section>
      </Page>
    );
  }

  const { load } = state;
  const { today, briefing, performance } = load.data;
  const stops = sortStops(today.visits);
  const sum = summarizeStops(stops);
  const savedTime = formatTime(load.savedAt, lang, props.now);

  return (
    <Page width="small">
      {header(formatDay(today.date, lang))}

      {load.source === "cache" ? (
        <Page.Section>
          <Alert
            variant="warning"
            size="compact"
            title={load.stale ? t("staleTitle", { date: formatDay(today.date, lang) }) : t("offlineTitle")}
            description={
              load.stale
                ? t("staleBody")
                : load.fallbackReason === "offline"
                  ? t("offlineBody", { time: savedTime })
                  : t("cachedAfterError", { code: load.fallbackReason ?? "", time: savedTime })
            }
          />
        </Page.Section>
      ) : load.failed.length ? (
        <Page.Section>
          <Alert variant="info" size="compact" description={t("partial", { what: load.failed.map((f) => t(f === "plan" ? "openWeek" : f === "briefing" ? "briefing" : "performance")).join(", ") })} />
        </Page.Section>
      ) : null}

      <Page.Section>
        <Card>
          <Card.Content>
            <Layout.Row split gap="sm">
              <Layout.Stack gap="xs">
                <Text variant="sm" color="secondary">{t("stops")}</Text>
                <Text variant="h3">{String(sum.total)}</Text>
              </Layout.Stack>
              <Layout.Stack gap="xs">
                <Text variant="sm" color="secondary">{t("done")}</Text>
                <Text variant="h3">{`${sum.done}/${sum.total}`}</Text>
              </Layout.Stack>
              <Layout.Stack gap="xs">
                <Text variant="sm" color="secondary">{t("recordings")}</Text>
                <Text variant="h3">{String(today.pending_recordings_hint)}</Text>
              </Layout.Stack>
            </Layout.Row>
          </Card.Content>
        </Card>
      </Page.Section>

      <Page.Section>
        {stops.length === 0 ? (
          <EmptyState
            variant="primary"
            icon={<Icon icon={CalendarBlankIcon} />}
            title={t("empty")}
            description={t("emptyBody")}
            actions={[{ label: t("openWeek"), onClick: props.onOpenWeek }]}
          />
        ) : (
          <Card withHeaderDivider>
            <Card.Header
              icon={<Icon icon={StorefrontIcon} />}
              title={t("stopsCount", { n: sum.total })}
              description={sum.next ? t("next", { name: sum.next.account.name }) : undefined}
              actions={
                <Button size="small" variant="primary" prefix={<Icon icon={MicrophoneIcon} />} onClick={props.onRecord}>
                  {t("record")}
                </Button>
              }
            />
            <Card.List>
              {stops.map((v, i) => (
                <StopRow key={`${v.visit_id}:${i}`} v={v} index={i} t={t} onOpen={() => props.onOpenAccount(v.account.id)} />
              ))}
            </Card.List>
          </Card>
        )}
      </Page.Section>

      <Page.Section>
        <Card withHeaderDivider>
          <Card.Header icon={<Icon icon={SunHorizonIcon} />} title={t("briefing")} />
          {briefing ? (
            <>
              <Card.List>
                {[...briefing.items]
                  .sort((a, b) => a.position - b.position)
                  .map((it, i) => (
                    <Card.List.Item key={`${it.position}:${i}`}>
                      <Text variant="sm">{it.display_text}</Text>
                    </Card.List.Item>
                  ))}
              </Card.List>
              <Card.Content>
                <Layout.Stack gap="sm">
                  <Button variant="link" size="small" onClick={() => setScriptOpen((o) => !o)} aria-expanded={scriptOpen}>
                    {t("briefingScript")}
                  </Button>
                  {scriptOpen ? (
                    <Text variant="sm" color="secondary">
                      {briefing.script_text}
                    </Text>
                  ) : null}
                </Layout.Stack>
              </Card.Content>
            </>
          ) : (
            <Card.Content>
              <Text variant="sm" color="secondary">
                {t("briefingNone")}
              </Text>
            </Card.Content>
          )}
        </Card>
      </Page.Section>

      {performance ? (
        <Page.Section>
          <Card withHeaderDivider>
            <Card.Header title={t("performance")} />
            <Card.Content>
              <Layout.Stack gap="md">
                <Layout.Row split gap="sm">
                  <Layout.Stack gap="xs">
                    <Text variant="sm" color="secondary">{t("visitsDone")}</Text>
                    <Text variant="lg" weight="bold">{String(performance.visits_done)}</Text>
                  </Layout.Stack>
                  <Layout.Stack gap="xs">
                    <Text variant="sm" color="secondary">{t("revenue")}</Text>
                    <Text variant="lg" weight="bold">{formatMoney(performance.revenue_minor, lang)}</Text>
                  </Layout.Stack>
                  <Layout.Stack gap="xs">
                    <Text variant="sm" color="secondary">{t("newCustomers")}</Text>
                    <Text variant="lg" weight="bold">{String(performance.new_customers)}</Text>
                  </Layout.Stack>
                </Layout.Row>
                {performance.targets.map((g) => (
                  <Layout.Stack key={g.target_id} gap="xs">
                    <Layout.Row split>
                      <Text variant="sm" weight="medium">{t(`metric.${g.metric}`)}</Text>
                      <Text variant="sm" color="secondary">
                        {formatTargetValue(g.metric, g.actual_value, lang)} / {formatTargetValue(g.metric, g.target_value, lang)}
                      </Text>
                    </Layout.Row>
                    <Progress value={clampPct(g.pct)} size="small" color={clampPct(g.pct) >= 100 ? "success" : "default"} />
                    <Text variant="sm" color="tertiary">{t("daysLeft", { n: g.days_left })}</Text>
                  </Layout.Stack>
                ))}
              </Layout.Stack>
            </Card.Content>
          </Card>
        </Page.Section>
      ) : null}

      <Page.Section>
        <Text variant="sm" color="tertiary" align="center">
          {t("savedAt", { time: savedTime })}
        </Text>
      </Page.Section>
    </Page>
  );
}
