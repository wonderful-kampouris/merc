import { Badge, Button, Card, EmptyState, Layout, Page, Skeleton, ToggleGroup } from "@wonderful/ui-base";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ApprovalCard } from "../../../contracts";
import { MercApiError } from "../../../lib/client";
import { useScreenI18n } from "../../../lib/i18n";
import type { ScreenProps } from "../../../lib/screenRegistry";
import { useLive } from "../../../lib/useLive";
import ApprovalItem from "./ApprovalItem";
import messages from "./i18n";
import { afterDecision, decideRequest, isOpen, upsert, visible, type Decision, type ListFilter } from "./logic";

type Load = { state: "loading" } | { state: "error"; message: string } | { state: "ready" };

/** Error code -> screen message key for a failed fn:approval-decide. */
export function decideErrorKey(e: unknown): { key: string; msg: string } {
  const msg = e instanceof Error ? e.message : String(e);
  if (e instanceof MercApiError && ["validation_failed", "conflict", "forbidden", "not_found"].includes(e.code)) {
    return { key: `err_${e.code}`, msg };
  }
  return { key: "err_generic", msg };
}

/** Management approvals, mobile-first (REQ-DSC-009): one tap to approve or reject, inline counter-offer %. */
export default function ManagerApprovals({ screen, client, openLiveSocket, lang }: ScreenProps) {
  const { t } = useScreenI18n(messages);
  const [filter, setFilter] = useState<ListFilter>("pending");
  const [items, setItems] = useState<ApprovalCard[]>([]);
  const [decided, setDecided] = useState<ApprovalCard[]>([]);
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [busy, setBusy] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, { result?: string; error?: string }>>({});
  const filterRef = useRef(filter);
  filterRef.current = filter;

  const refetch = useCallback(
    async (silent = false) => {
      if (!silent) setLoad({ state: "loading" });
      try {
        const res = await client.call("manager-approvals-list", { status: filterRef.current === "pending" ? "pending" : null });
        setItems(res.items);
        setLoad({ state: "ready" });
      } catch (e) {
        if (!silent) setLoad({ state: "error", message: e instanceof Error ? e.message : String(e) });
      }
    },
    [client],
  );

  useEffect(() => {
    void refetch();
  }, [refetch, filter]);

  const live = useLive({
    types: screen.events,
    openSocket: openLiveSocket,
    poll: () => refetch(true),
    onEvent: (e) => {
      if (e.type === "approval.created") setItems((xs) => upsert(xs, (e.payload as { approval: ApprovalCard }).approval));
    },
  });

  const decide = async (card: ApprovalCard, decision: Decision, opts: { pct?: number | null; note?: string | null }) => {
    setBusy(card.approval_id);
    setNotes((n) => ({ ...n, [card.approval_id]: {} }));
    try {
      const res = await client.call("approval-decide", decideRequest(card, decision, opts));
      const next = afterDecision(card, decision, res.approval, opts.pct);
      setItems((xs) => xs.filter((x) => x.approval_id !== card.approval_id));
      setDecided((xs) => upsert(xs, next));
      const result = res.requester_notified ? t("notified", { name: card.requested_by.full_name }) : t("not_notified");
      setNotes((n) => ({ ...n, [card.approval_id]: { result } }));
    } catch (e) {
      const { key, msg } = decideErrorKey(e);
      setNotes((n) => ({ ...n, [card.approval_id]: { error: t(key as never, { msg }) } }));
    } finally {
      setBusy(null);
    }
  };

  const decidedIds = new Set(decided.map((d) => d.approval_id));
  const shown = visible(items.filter((x) => !decidedIds.has(x.approval_id)), filter);
  const pending = items.filter((x) => isOpen(x) && !decidedIds.has(x.approval_id)).length;

  return (
    <Page width="small">
      <Page.Header
        title={t("screen.management.approvals")}
        description={t("subtitle")}
        actions={
          <Layout.Row gap="xs" wrap>
            {load.state === "ready" ? <Badge text={t("pending_count", { n: pending })} color={pending ? "blue" : "muted"} size="small" /> : null}
            {client.mock ? <Badge text={t("badge.mock")} color="purple" size="small" /> : null}
            {live ? (
              <Badge text={t(live === "socket" ? "live.socket" : live === "polling" ? "live.polling" : "live.connecting")} color={live === "socket" ? "green" : "orange"} isDot={live === "socket"} size="small" />
            ) : null}
          </Layout.Row>
        }
      />
      <Page.Section>
        <ToggleGroup value={filter} onChange={(v) => setFilter(v as ListFilter)} size="small" isFullWidth aria-label={t("filter_label")}>
          <ToggleGroup.Item value="pending" text={t("filter_pending")} />
          <ToggleGroup.Item value="all" text={t("filter_all")} />
        </ToggleGroup>
      </Page.Section>
      <Page.Section>
        {load.state === "loading" ? (
          <Layout.Stack gap="md" aria-busy="true" aria-label={t("common.loading")}>
            {[0, 1].map((i) => (
              <Card key={i}>
                <Card.Content>
                  <Layout.Stack gap="sm">
                    <Skeleton width="60%" height={20} />
                    <Skeleton width={120} height={32} />
                    <Skeleton.Text rows={2} />
                  </Layout.Stack>
                </Card.Content>
              </Card>
            ))}
          </Layout.Stack>
        ) : load.state === "error" ? (
          <EmptyState title={t("error_title")} description={load.message} actions={[{ label: t("retry"), onClick: () => void refetch() }]} />
        ) : shown.length === 0 && decided.length === 0 ? (
          <EmptyState title={t("empty_title")} description={t("empty_body")} />
        ) : (
          <Layout.Stack gap="md">
            {shown.map((card) => (
              <ApprovalItem
                key={card.approval_id}
                card={card}
                lang={lang}
                t={t as never}
                busy={busy === card.approval_id}
                error={notes[card.approval_id]?.error}
                onDecide={(d, o) => void decide(card, d, o)}
              />
            ))}
          </Layout.Stack>
        )}
      </Page.Section>
      {decided.length ? (
        <Page.Section>
          <Layout.Stack gap="md">
            <Layout.Row split>
              <Badge text={t("decided_title")} color="neutral" />
              <Button variant="tertiary" size="small" onClick={() => setDecided([])}>
                {t("clear")}
              </Button>
            </Layout.Row>
            {decided.map((card) => (
              <ApprovalItem key={card.approval_id} card={card} lang={lang} t={t as never} result={notes[card.approval_id]?.result} onDecide={() => undefined} />
            ))}
          </Layout.Stack>
        </Page.Section>
      ) : null}
    </Page>
  );
}
