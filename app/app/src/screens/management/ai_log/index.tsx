import { RobotIcon } from "@phosphor-icons/react";
import { Badge, Button, Card, Icon, InputText, Layout, Page, Select, Text } from "@wonderful/ui-base";
import { useState } from "react";
import { useScreenI18n } from "../../../lib/i18n";
import type { ScreenProps } from "../../../lib/screenRegistry";
import { Empty, LoadView, RichRow } from "../settings/KitView";
import { humanize, useLoad } from "../settings/kit";
import messages from "./i18n";
import { CLASS_COLOR, defaultFilters, pageCount, STATUS_COLOR, STATUSES, statusCounts, toQuery, type ActionStatus, type Filters } from "./model";

export default function MgmtAiLog({ client }: ScreenProps) {
  const { t } = useScreenI18n(messages);
  const [f, setF] = useState<Filters>(defaultFilters);
  const q = toQuery(f);
  const state = useLoad(() => client.call("ai-actions-list", q), [client, JSON.stringify(q)]);
  const set = (patch: Partial<Filters>) => setF({ ...f, page: 1, ...patch });

  return (
    <Page width="medium">
      <Page.Header title={t("screen.management.ai_log")} description={t("subtitle")} />
      <Page.Toolbar actions={<Button size="small" variant="tertiary" onClick={() => setF(defaultFilters())}>{t("clear")}</Button>}>
        <Layout.Row gap="sm" wrap>
          <Select<ActionStatus | "">
            aria-label={t("status")}
            size="small"
            options={[{ value: "", label: t("all") }, ...STATUSES.map((s) => ({ value: s, label: t(`status.${s}`) }))]}
            value={f.status}
            onChange={(v) => set({ status: v })}
          />
          <InputText size="small" type="date" aria-label={t("from")} value={f.from} onChange={(e) => set({ from: e.target.value })} />
          <InputText size="small" type="date" aria-label={t("to")} value={f.to} onChange={(e) => set({ to: e.target.value })} />
        </Layout.Row>
      </Page.Toolbar>
      <Page.Section>
        <LoadView state={state} onRetry={state.reload} retryLabel={t("retry")} errorTitle={t("common.error")}>
          {(r) => {
            if (!r.items.length) return <Empty title={t("empty")} description={t("emptyHint")} />;
            const pages = pageCount(r.page.total, r.page.limit);
            const counts = statusCounts(r.items);
            return (
              <Card>
                <Card.Header
                  title={t("total", { n: r.page.total })}
                  actions={
                    <Layout.Row gap="xs" wrap>
                      {STATUSES.filter((s) => counts[s]).map((s) => <Badge key={s} size="small" color={STATUS_COLOR[s]} text={`${t(`status.${s}`)} ${counts[s]}`} />)}
                    </Layout.Row>
                  }
                />
                <Card.List>
                  {r.items.map((a) => (
                    <RichRow
                      key={a.ai_action_id}
                      avatar={<Icon icon={RobotIcon} />}
                      title={a.summary}
                      description={
                        <Layout.Row gap="xs" wrap>
                          <Badge size="small" color={STATUS_COLOR[a.status]} text={t(`status.${a.status}`)} />
                          <Badge size="small" variant="outlined" color={CLASS_COLOR[a.action_class]} text={t(`class.${a.action_class}`)} />
                          <Text variant="sm" color="secondary">{humanize(a.action_type)}</Text>
                          {a.approval_id ? <Text variant="sm" color="secondary">· {t("approval")}</Text> : null}
                          {a.undoable && a.status === "applied" ? <Text variant="sm" color="secondary">· {t("undoable")}</Text> : null}
                        </Layout.Row>
                      }
                    />
                  ))}
                </Card.List>
                {pages > 1 ? (
                  <Card.Footer>
                    <Layout.Row gap="sm">
                      <Text variant="sm" color="secondary">{t("pageOf", { page: r.page.page, pages })}</Text>
                      <Button size="small" disabled={f.page <= 1} onClick={() => setF({ ...f, page: f.page - 1 })}>{t("prev")}</Button>
                      <Button size="small" disabled={f.page >= pages} onClick={() => setF({ ...f, page: f.page + 1 })}>{t("next")}</Button>
                    </Layout.Row>
                  </Card.Footer>
                ) : null}
              </Card>
            );
          }}
        </LoadView>
      </Page.Section>
    </Page>
  );
}
