import { Badge, Button, Card, Icon, InputNumber, InputText, Layout, Modal, Notice, Page, Select, Text, Tooltip } from "@wonderful/ui-base";
import { ArrowsClockwiseIcon, PlusIcon, StorefrontIcon } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import type { AccountRef } from "../../../contracts";
import type { MercClient } from "../../../lib/client";
import { screenTitleKey, useScreenI18n, type Lang } from "../../../lib/i18n";
import type { ScreenProps } from "../../../lib/screenRegistry";
import { useDirectory } from "../dashboard/shared/directory";
import { errorDetail, errorKey } from "../dashboard/shared/errors";
import { date, labelOf, money, num } from "../dashboard/shared/format";
import { Region } from "../dashboard/shared/Region";
import { useAsync } from "../dashboard/shared/useAsync";
import { personOption } from "../../../shell/RepAvatar";
import messages from "./i18n";
import {
  applyMove,
  filterDeals,
  groupByStage,
  moveRequest,
  newDealRequest,
  STAGES,
  stageName,
  toDeal,
  weightedPipeline,
  type Deal,
  type NewDealForm,
  type StageColumn,
} from "./logic";

type Key = keyof typeof messages.en;
type T = ReturnType<typeof useScreenI18n<Key>>["t"];

/** Management pipeline (REQ-DSH-001 pipeline KPI, metrics.md#weighted-pipeline): deals by stage, move stage, new deal, customer detail. */
export default function Pipeline({ screen, client, lang }: ScreenProps) {
  const { t } = useScreenI18n(messages);
  const [q, setQ] = useState("");
  const [stage, setStage] = useState<string | null>(null);
  const [owner, setOwner] = useState<string | null>(null);
  const [moves, setMoves] = useState<Record<string, string>>({});
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [accountId, setAccountId] = useState<string | null>(null);

  const deals = useAsync(async () => {
    const r = await client.call("deals-list", { limit: 200 });
    return r.items.map(toDeal).filter((d): d is Deal => d !== null);
  }, "deals");
  const accounts = useAsync(async () => (await client.call("accounts-list", { limit: 200 })).items, "accounts");
  const dir = useDirectory(client, screen.functions);
  const accountName = useMemo(() => {
    const m = new Map((accounts.data ?? []).map((a) => [a.id, a.name]));
    return (id: string) => m.get(id) ?? dir.name("account", id);
  }, [accounts.data, dir]);

  const move = async (d: Deal, to: string) => {
    if (to === d.stage_code) return;
    setMoves((m) => ({ ...m, [d.id]: to }));
    try {
      await client.call("deal-upsert", moveRequest(d, to));
      setNote({ ok: true, text: t("deal.moved", { stage: stageName(to, lang) }) });
      deals.reload();
    } catch (e) {
      setMoves((m) => {
        const { [d.id]: _drop, ...rest } = m;
        return rest;
      });
      setNote({ ok: false, text: t("deal.moveFailed", { msg: t(errorKey(e)) }) });
    }
  };

  return (
    <>
      <Page width="full">
        <Page.Header
          title={t(screenTitleKey(screen.shell, screen.key))}
          description={t("subtitle")}
          actions={
            <Layout.Row gap="xs" wrap>
              <Tooltip content={t("retry")}>
                <Button size="small" variant="tertiary" aria-label={t("retry")} prefix={<Icon icon={ArrowsClockwiseIcon} />} onClick={deals.reload} />
              </Tooltip>
              <Button size="small" variant="primary" prefix={<Icon icon={PlusIcon} />} onClick={() => setCreating(true)}>
                {t("deal.new")}
              </Button>
            </Layout.Row>
          }
        />
        <Page.Toolbar>
          <Layout.Row gap="sm" wrap>
            <InputText size="small" type="search" aria-label={t("search")} placeholder={t("search")} value={q} onChange={(e) => setQ(e.target.value)} />
            <Select
              size="small"
              aria-label={t("filter.stage")}
              value={stage ?? ""}
              onChange={(v) => setStage(v || null)}
              options={[{ value: "", label: `${t("filter.stage")}: ${t("filter.all")}` }, ...STAGES.map((s) => ({ value: s.code, label: stageName(s.code, lang) }))]}
            />
            <Select
              size="small"
              aria-label={t("filter.owner")}
              value={owner ?? ""}
              onChange={(v) => setOwner(v || null)}
              options={[{ value: "", label: `${t("filter.owner")}: ${t("filter.all")}` }, ...dir.reps.map((r) => ({ value: r.id, label: r.name }))]}
              renderOption={personOption} renderValue={personOption}
            />
            {client.mock ? <Badge text={t("mock.note")} color="purple" size="small" /> : null}
          </Layout.Row>
        </Page.Toolbar>
        {note ? (
          <Page.Section>
            <Notice variant={note.ok ? "info" : "warning"} size="compact" description={note.text} />
          </Page.Section>
        ) : null}
        <Page.Section>
          <Region state={deals} t={t} rows={8} isEmpty={(d) => d.length === 0} emptyTitle={t("empty")} emptyBody={t("emptyBody")}>
            {(all) => {
              const shown = filterDeals(applyMoves(all, moves), { q, stage, owner }, accountName);
              return <PipelineBoard deals={shown} total={all.length} lang={lang} t={t} accountName={accountName} onMove={(d, s) => void move(d, s)} onOpen={setAccountId} />;
            }}
          </Region>
        </Page.Section>
      </Page>
      {creating ? (
        <NewDealModal
          client={client}
          accounts={accounts.data ?? []}
          t={t}
          lang={lang}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            deals.reload();
          }}
        />
      ) : null}
      {accountId ? <AccountModal client={client} accountId={accountId} lang={lang} t={t} onClose={() => setAccountId(null)} /> : null}
    </>
  );
}

const applyMoves = (deals: Deal[], moves: Record<string, string>) => Object.entries(moves).reduce((ds, [id, s]) => applyMove(ds, id, s), deals);

/** Pure board view (tested with SSR): totals, then one card per stage. */
export function PipelineBoard(props: {
  deals: readonly Deal[];
  total: number;
  lang: Lang;
  t: T;
  accountName: (id: string) => string | undefined;
  onMove: (d: Deal, stage: string) => void;
  onOpen: (accountId: string) => void;
}) {
  const { deals, lang, t } = props;
  const cols = groupByStage(deals);
  const open = cols.filter((c) => !c.stage.is_closed);
  const won = cols.filter((c) => c.stage.is_won);
  return (
    <Layout.Stack gap="lg">
      <Layout.Grid idealColumns={3}>
        <Card>
          <Card.Header title={t("weighted")} />
          <Card.Stat value={money(weightedPipeline(deals), lang, true)} />
        </Card>
        <Card>
          <Card.Header title={t("open")} />
          <Card.Stat value={num(open.reduce((n, c) => n + c.deals.length, 0), lang, 0)} suffix={money(open.reduce((n, c) => n + c.amount_minor, 0), lang, true)} />
        </Card>
        <Card>
          <Card.Header title={t("won")} />
          <Card.Stat value={money(won.reduce((n, c) => n + c.amount_minor, 0), lang, true)} />
        </Card>
      </Layout.Grid>
      {deals.length === 0 && props.total > 0 ? (
        <Text variant="body-sm" color="secondary">
          {t("noMatch")}
        </Text>
      ) : (
        <Layout.Grid idealColumns={3}>
          {cols
            .filter((c) => c.deals.length > 0 || !c.stage.is_closed)
            .map((c) => (
              <StageCard key={c.stage.code} col={c} {...props} />
            ))}
        </Layout.Grid>
      )}
    </Layout.Stack>
  );
}

function StageCard(props: { col: StageColumn; lang: Lang; t: T; accountName: (id: string) => string | undefined; onMove: (d: Deal, s: string) => void; onOpen: (id: string) => void }) {
  const { col, lang, t } = props;
  const pctLabel = `${Math.round(col.stage.probability * 100)}%`;
  return (
    <Card data-stage={col.stage.code}>
      <Card.Header
        title={`${stageName(col.stage.code, lang)} · ${pctLabel}`}
        description={`${t("stage.count", { n: col.deals.length, amount: money(col.amount_minor, lang, true) })}${col.stage.is_closed ? "" : ` · ${t("stage.weighted", { amount: money(col.weighted_minor, lang, true) })}`}`}
      />
      {col.deals.length === 0 ? (
        <Card.Content>
          <Text variant="body-sm" color="secondary">
            {t("stage.empty")}
          </Text>
        </Card.Content>
      ) : (
        <Card.List>
          {col.deals.map((d) => (
            <Card.Meta
              key={d.id}
              title={d.title}
              description={[d.account_name ?? props.accountName(d.account_id) ?? "—", money(d.amount_minor, lang), d.expected_close_date ? t("deal.close", { d: date(d.expected_close_date, lang) }) : null, d.next_step ? t("deal.next", { s: d.next_step }) : null]
                .filter(Boolean)
                .join(" · ")}
              actions={
                <Layout.Row gap="xs">
                  <Select
                    size="small"
                    aria-label={`${t("deal.move")}: ${d.title}`}
                    value={d.stage_code}
                    width={140}
                    onChange={(v) => props.onMove(d, v)}
                    options={STAGES.map((s) => ({ value: s.code, label: stageName(s.code, lang) }))}
                  />
                  <Tooltip content={t("deal.open")}>
                    <Button size="small" variant="tertiary" aria-label={`${t("deal.open")}: ${d.title}`} prefix={<Icon icon={StorefrontIcon} />} onClick={() => props.onOpen(d.account_id)} />
                  </Tooltip>
                </Layout.Row>
              }
            />
          ))}
        </Card.List>
      )}
    </Card>
  );
}

function NewDealModal(props: { client: MercClient; accounts: readonly AccountRef[]; t: T; lang: Lang; onClose: () => void; onSaved: () => void }) {
  const { t, lang } = props;
  const [f, setF] = useState<NewDealForm>({ account_id: "", title: "", amount_eur: null, stage_code: "new", expected_close_date: "", next_step: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const req = newDealRequest(f);
  const save = async () => {
    if (!req) return setErr(t("form.required"));
    setBusy(true);
    setErr(null);
    try {
      await props.client.call("deal-upsert", req);
      props.onSaved();
    } catch (e) {
      setErr(`${t(errorKey(e))} ${errorDetail(e)}`);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={props.onClose}
      title={t("deal.new")}
      footer={
        <Modal.Footer>
          <Button variant="secondary" onClick={props.onClose}>
            {t("form.cancel")}
          </Button>
          <Button variant="primary" loading={busy} disabled={!req} onClick={() => void save()}>
            {t("form.save")}
          </Button>
        </Modal.Footer>
      }
    >
      <Layout.Stack gap="md">
        <Select
          aria-label={t("form.account")}
          placeholder={t("form.account")}
          isSearchable
          value={f.account_id}
          onChange={(v) => setF({ ...f, account_id: v })}
          options={props.accounts.map((a) => ({ value: a.id, label: a.city ? `${a.name} · ${a.city}` : a.name }))}
        />
        <InputText label={t("form.title")} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
        <InputNumber label={t("form.amount")} value={f.amount_eur} min={0} onChange={(v) => setF({ ...f, amount_eur: v })} />
        <Select aria-label={t("form.stage")} value={f.stage_code} onChange={(v) => setF({ ...f, stage_code: v })} options={STAGES.filter((s) => !s.is_closed).map((s) => ({ value: s.code, label: stageName(s.code, lang) }))} />
        <InputText type="date" label={t("form.close")} value={f.expected_close_date} onChange={(e) => setF({ ...f, expected_close_date: e.target.value })} />
        <InputText label={t("form.next")} value={f.next_step} onChange={(e) => setF({ ...f, next_step: e.target.value })} />
        {err ? <Notice variant="warning" size="compact" description={err} /> : null}
      </Layout.Stack>
    </Modal>
  );
}

function AccountModal(props: { client: MercClient; accountId: string; lang: Lang; t: T; onClose: () => void }) {
  const { t, lang } = props;
  const state = useAsync(() => props.client.call("account-get", { account_id: props.accountId }), props.accountId);
  const list = (rows: Record<string, unknown>[], keys: string[]) =>
    rows.length === 0 ? (
      <Card.Content>
        <Text variant="body-sm" color="secondary">
          {t("account.none")}
        </Text>
      </Card.Content>
    ) : (
      <Card.List>
        {rows.slice(0, 8).map((r, i) => (
          <Card.Meta
            key={typeof r.id === "string" ? r.id : i}
            title={labelOf(r, keys)}
            description={[r.role, r.phone, r.email, r.stage_code, typeof r.amount_minor === "number" ? money(r.amount_minor, lang) : null, r.kind, r.occurred_at ? date(String(r.occurred_at), lang) : null]
              .filter((x) => typeof x === "string" && x)
              .join(" · ")}
          />
        ))}
      </Card.List>
    );
  return (
    <Modal
      open
      size="large"
      onClose={props.onClose}
      title={state.data ? labelOf(state.data.account) : t("account.title")}
      description={state.data ? [state.data.account.city, state.data.account.phone].filter((x) => typeof x === "string").join(" · ") : undefined}
      footer={
        <Modal.Footer>
          <Button variant="primary" onClick={props.onClose}>
            {t("account.close")}
          </Button>
        </Modal.Footer>
      }
    >
      <Region state={state} t={t}>
        {(d) => (
          <Layout.Stack gap="md">
            <Card>
              <Card.Header title={t("account.deals")} />
              {list(d.deals, ["title", "name"])}
            </Card>
            <Card>
              <Card.Header title={t("account.contacts")} />
              {list(d.contacts, ["full_name", "name"])}
            </Card>
            <Card>
              <Card.Header title={t("account.activities")} />
              {list(d.activities, ["summary", "title", "kind", "name"])}
            </Card>
          </Layout.Stack>
        )}
      </Region>
    </Modal>
  );
}
