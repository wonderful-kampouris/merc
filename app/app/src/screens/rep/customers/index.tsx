import { Alert, Button, Layout, Page, Skeleton } from "@wonderful/ui-base";
import { useCallback, useEffect, useRef, useState } from "react";
import type { OrderSummary, VisitCard } from "../../../contracts";
import { MercApiError } from "../../../lib/client";
import { useScreenI18n } from "../../../lib/i18n";
import type { ScreenProps } from "../../../lib/screenRegistry";
import { formatMoney } from "../today/todayModel";
import AccountList, { type ListState } from "./AccountList";
import { clearCustomerFocus, peekCustomerFocus, setCustomerFocus } from "./customerFocus";
import { addContact, repeatOrderAsDraft, updateProblem, withProblemStatus } from "./customersActions";
import { accountsRequest, type AccountFilter, type ContactDraft } from "./customersModel";
import messages from "./i18n";
import VisitCardView, { type DetailsState, type Notice } from "./VisitCardView";

type CardState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; card: VisitCard };

const errText = (e: unknown): string => (e instanceof MercApiError ? `${e.code}: ${e.message}` : e instanceof Error ? e.message : String(e));
const SEARCH_DEBOUNCE_MS = 300;

/** Rep "Customers": searchable account list and the visit card (customer or prospect) with quick edits. */
export default function Customers({ client, lang }: ScreenProps) {
  const { t } = useScreenI18n(messages);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<AccountFilter>("all");
  const [list, setList] = useState<ListState>({ status: "loading" });
  const [openId, setOpenId] = useState<string | null>(() => peekCustomerFocus());
  const [card, setCard] = useState<CardState>({ status: "loading" });
  const [details, setDetails] = useState<DetailsState | null>(null);
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [notice, setNotice] = useState<Notice>(null);
  const listSeq = useRef(0);
  const cardSeq = useRef(0);

  const loadList = useCallback(async () => {
    const mine = ++listSeq.current;
    setList({ status: "loading" });
    try {
      const r = await client.call("accounts-list", accountsRequest(q, filter));
      if (mine === listSeq.current) setList({ status: "ready", items: r.items, total: r.page.total });
    } catch (e) {
      if (mine === listSeq.current) setList({ status: "error", message: errText(e) });
    }
  }, [client, q, filter]);

  useEffect(() => {
    if (openId) return;
    const h = setTimeout(() => void loadList(), q ? SEARCH_DEBOUNCE_MS : 0);
    return () => clearTimeout(h);
  }, [loadList, openId, q]);

  const loadCard = useCallback(
    async (accountId: string, quiet = false) => {
      const mine = ++cardSeq.current;
      if (!quiet) {
        setCard({ status: "loading" });
        setDetails({ status: "loading" });
      }
      const [c, d] = await Promise.allSettled([client.call("visit-card-get", { account_id: accountId }), client.call("account-get", { account_id: accountId })]);
      if (mine !== cardSeq.current) return;
      setCard(c.status === "fulfilled" ? { status: "ready", card: c.value } : { status: "error", message: errText(c.reason) });
      setDetails(d.status === "fulfilled" ? { status: "ready", value: d.value } : { status: "error", message: errText(d.reason) });
    },
    [client],
  );

  useEffect(() => {
    if (openId) void loadCard(openId);
  }, [openId, loadCard]);

  const withBusy = async (key: string, fn: () => Promise<void>) => {
    setBusy((b) => new Set(b).add(key));
    try {
      await fn();
    } finally {
      setBusy((b) => {
        const n = new Set(b);
        n.delete(key);
        return n;
      });
    }
  };

  const onProblem = (problemId: string, status: "in_progress" | "resolved") =>
    void withBusy(`problem:${problemId}`, async () => {
      try {
        await updateProblem(client, problemId, status);
        setCard((s) => (s.status === "ready" ? { ...s, card: withProblemStatus(s.card, problemId, status) } : s));
        setNotice(null);
      } catch (e) {
        setNotice({ kind: "error", text: t("actionFailed", { message: errText(e) }) });
      }
    });

  const onAddContact = async (d: ContactDraft): Promise<boolean> => {
    if (!openId) return false;
    try {
      await addContact(client, openId, d);
      setNotice({ kind: "success", text: t("contactSaved") });
      await loadCard(openId, true);
      return true;
    } catch (e) {
      setNotice({ kind: "error", text: t("actionFailed", { message: errText(e) }) });
      return false;
    }
  };

  const onReorder = (order: OrderSummary) =>
    void withBusy(`order:${order.order_id}`, async () => {
      if (!openId) return;
      try {
        const draft = await repeatOrderAsDraft(client, openId, order);
        setNotice({ kind: "success", text: t("draftCreated", { total: formatMoney(draft.total_minor, lang) }) });
      } catch (e) {
        setNotice({ kind: "error", text: t("actionFailed", { message: errText(e) }) });
      }
    });

  const back = () => {
    cardSeq.current++;
    clearCustomerFocus();
    setOpenId(null);
    setNotice(null);
    setDetails(null);
  };

  if (!openId) {
    return (
      <AccountList
        state={list}
        q={q}
        filter={filter}
        lang={lang}
        mock={client.mock}
        onQuery={setQ}
        onFilter={setFilter}
        onOpen={(a) => {
          setCustomerFocus(a.id);
          setOpenId(a.id);
        }}
        onRetry={() => void loadList()}
      />
    );
  }

  if (card.status !== "ready") {
    return (
      <Page width="small">
        <Page.Header title={t("title")} />
        <Page.Section>
          {card.status === "loading" ? (
            <Layout.Stack gap="md" aria-busy="true">
              <Skeleton height={96} radius="lg" />
              <Skeleton height={120} radius="lg" />
              <Skeleton height={120} radius="lg" />
            </Layout.Stack>
          ) : (
            <Alert
              variant="error"
              title={t("cardError")}
              description={card.message}
              action={
                <Layout.Row gap="xs">
                  <Button onClick={back}>{t("back")}</Button>
                  <Button variant="primary" onClick={() => void loadCard(openId)}>{t("retry")}</Button>
                </Layout.Row>
              }
            />
          )}
        </Page.Section>
      </Page>
    );
  }

  return (
    <VisitCardView
      card={card.card}
      details={details}
      lang={lang}
      mock={client.mock}
      notice={notice}
      busy={busy}
      onBack={back}
      onProblem={onProblem}
      onAddContact={onAddContact}
      onReorder={onReorder}
      onDismissNotice={() => setNotice(null)}
    />
  );
}
