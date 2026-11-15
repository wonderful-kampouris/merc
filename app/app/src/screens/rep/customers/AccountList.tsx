import { Alert, Badge, Button, Card, Elevation, EmptyState, Icon, Layout, NoResultsState, Page, SearchInput, Skeleton, Text, ToggleGroup } from "@wonderful/ui-base";
import { SparkleIcon, StorefrontIcon, UsersThreeIcon, WarningIcon } from "@phosphor-icons/react";
import type { AccountRef } from "../../../contracts";
import { useScreenI18n, type Lang } from "../../../lib/i18n";
import { ACCOUNT_FILTERS, formatKm, type AccountFilter } from "./customersModel";
import messages from "./i18n";

export type ListState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; items: AccountRef[]; total: number };

export interface AccountListProps {
  state: ListState;
  q: string;
  filter: AccountFilter;
  lang: Lang;
  mock: boolean;
  onQuery: (q: string) => void;
  onFilter: (f: AccountFilter) => void;
  onOpen: (account: AccountRef) => void;
  onRetry: () => void;
}

const TYPE_COLOR = { customer: "green", prospect: "blue", lost: "muted" } as const;

/** Account list with search and type / at-risk filter. Phone layout: one tappable card per account. */
export default function AccountList(props: AccountListProps) {
  const { t } = useScreenI18n(messages);
  const { state, lang } = props;
  return (
    <Page width="small">
      <Page.Header
        title={t("title")}
        description={state.status === "ready" ? t("count", { n: state.total }) : undefined}
        actions={props.mock ? <Badge text={t("badge.mock")} color="purple" size="small" /> : undefined}
      />
      <Page.Toolbar>
        <Layout.Stack gap="sm" className="w-full">
          <SearchInput
            value={props.q}
            placeholder={t("search")}
            aria-label={t("search")}
            clearLabel={t("clear")}
            onChange={(e) => props.onQuery(e.target.value)}
            onClear={() => props.onQuery("")}
            onSearch={(v) => props.onQuery(v)}
          />
          <ToggleGroup value={props.filter} onChange={(v) => props.onFilter(v as AccountFilter)} size="small" isFullWidth aria-label={t("filters")}>
            {ACCOUNT_FILTERS.map((f) => (
              <ToggleGroup.Item key={f} value={f} text={t(`filter.${f}`)} />
            ))}
          </ToggleGroup>
        </Layout.Stack>
      </Page.Toolbar>
      <Page.Section>
        {state.status === "loading" ? (
          <Layout.Stack gap="sm" aria-busy="true">
            <Skeleton height={64} radius="lg" />
            <Skeleton height={64} radius="lg" />
            <Skeleton height={64} radius="lg" />
          </Layout.Stack>
        ) : state.status === "error" ? (
          <Alert variant="error" title={t("loadError")} description={state.message} action={<Button onClick={props.onRetry}>{t("retry")}</Button>} />
        ) : state.items.length === 0 ? (
          props.q.trim() || props.filter !== "all" ? (
            <NoResultsState title={t("noResults", { q: props.q.trim() || t(`filter.${props.filter}`) })} description={t("noResultsBody")} />
          ) : (
            <EmptyState variant="primary" icon={<Icon icon={UsersThreeIcon} />} title={t("empty")} description={t("emptyBody")} />
          )
        ) : (
          <Layout.Stack gap="sm">
            {state.items.map((a, i) => (
              <Elevation key={`${a.id}:${i}`} level="sm" clickable asChild>
                <Card as="button" onClick={() => props.onOpen(a)} aria-label={a.name}>
                  <Card.Meta
                    avatar={<Icon icon={a.account_type === "prospect" ? SparkleIcon : StorefrontIcon} />}
                    title={a.name}
                    description={[
                      [a.city, a.postal_code].filter(Boolean).join(" · "),
                      typeof a.distance_m === "number" ? t("distance", { km: formatKm(a.distance_m, lang) }) : null,
                      a.reason,
                    ]
                      .filter(Boolean)
                      .join(" — ")}
                    actions={
                      <Layout.Row gap="xs">
                        {props.filter === "at_risk" ? <Icon icon={WarningIcon} /> : null}
                        <Badge text={t(a.account_type)} color={TYPE_COLOR[a.account_type]} size="small" />
                      </Layout.Row>
                    }
                  />
                </Card>
              </Elevation>
            ))}
          </Layout.Stack>
        )}
      </Page.Section>
      {state.status === "ready" && state.total > state.items.length ? (
        <Page.Section>
          <Text variant="sm" color="tertiary" align="center">
            {state.items.length} / {state.total}
          </Text>
        </Page.Section>
      ) : null}
    </Page>
  );
}
