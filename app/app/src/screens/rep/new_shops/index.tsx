import { useState } from "react";
import type { CandidateCard } from "../../../contracts";
import { useScreenI18n } from "../../../lib/i18n";
import type { ScreenProps } from "../../../lib/screenRegistry";
import { useLive } from "../../../lib/useLive";
import { getErrorDetail, getErrorKey } from "../approvals/kit/errorKey";
import type { FeedbackMessage } from "../approvals/kit/Feedback";
import { useOverrides } from "../approvals/kit/useOverrides";
import { useResource } from "../approvals/kit/useResource";
import type { CandidateAction } from "./CandidateItem";
import messages from "./i18n";
import { createAddBody, createSearchBody, EMPTY_ADD, getCandidateId, getReady, type AddForm } from "./logic";
import NewShopsView from "./NewShopsView";
import type { SearchState } from "./SearchCard";

/** /rep/new-shops: candidates-list, candidate-act, prospect-search, candidate-add; live candidates.ready. */
export default function NewShops({ screen, client, openLiveSocket, navigate }: ScreenProps) {
  const { t } = useScreenI18n(messages);
  const [filterId, setFilterId] = useState<string | null>(null);
  const [area, setArea] = useState("");
  const [category, setCategory] = useState("");
  const [search, setSearch] = useState<SearchState | null>(null);
  const [searching, setSearching] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [addForm, setAddForm] = useState<AddForm>(EMPTY_ADD);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<Record<string, CandidateAction>>({});
  const [feedback, setFeedback] = useState<(FeedbackMessage & { week?: boolean }) | null>(null);
  const { state, reload } = useResource(
    async () => (await client.call("candidates-list", { search_id: filterId, limit: 50 })).items,
    `cands:${filterId ?? "all"}`,
  );
  const overrides = useOverrides<CandidateCard>(getCandidateId);
  const fail = (e: unknown) => setFeedback({ kind: "error", text: `${t("actionFailed")}. ${t(getErrorKey(e))}`, detail: getErrorDetail(e) });

  useLive({
    types: screen.events,
    openSocket: openLiveSocket,
    poll: () => reload(),
    onEvent: (e) => {
      const ready = getReady(e);
      if (!ready) return;
      setSearch((s) => (s && s.searchId === ready.searchId ? { ...s, ready } : s));
      if (search?.searchId === ready.searchId) setFilterId(ready.searchId);
      else void reload();
    },
  });

  const runSearch = async () => {
    const body = createSearchBody(area, category);
    if (!body) return;
    setSearching(true);
    try {
      const r = await client.call("prospect-search", body);
      setSearch({ searchId: r.search_id, area: body.area_text });
    } catch (e) {
      fail(e);
    } finally {
      setSearching(false);
    }
  };

  const addShop = async () => {
    const body = createAddBody(addForm);
    if (!body) return;
    setAdding(true);
    try {
      const r = await client.call("candidate-add", body);
      setFeedback(
        r.duplicate_of
          ? { kind: "warning", text: t("add.duplicate", { name: r.duplicate_of.name }) }
          : { kind: "success", text: t("add.done", { name: body.business_name }) },
      );
      setAddForm(EMPTY_ADD);
      setAddOpen(false);
      void reload();
    } catch (e) {
      fail(e);
    } finally {
      setAdding(false);
    }
  };

  const act = async (c: CandidateCard, action: CandidateAction) => {
    setBusy((b) => ({ ...b, [c.candidate_id]: action }));
    try {
      // date null: fn:candidate-act offers the visit on the rep's next free day.
      const r = await client.call("candidate-act", { candidate_id: c.candidate_id, action, date: null });
      const server = state.status === "ready" ? state.data.find((x) => x.candidate_id === c.candidate_id) : undefined;
      overrides.record(c.candidate_id, server, action === "add_to_route" ? { ...r.candidate, status: r.candidate.status === c.status ? "added" : r.candidate.status } : { ...r.candidate, status: "dismissed" });
      setFeedback(
        action === "add_to_route"
          ? { kind: "success", text: t("result.added", { name: c.business_name }), week: true }
          : { kind: "info", text: t("result.dismissed", { name: c.business_name }) },
      );
    } catch (e) {
      fail(e);
    } finally {
      setBusy((b) => {
        const next = { ...b };
        delete next[c.candidate_id];
        return next;
      });
    }
  };

  const view = state.status === "ready" ? { ...state, data: overrides.merge(state.data) } : state;
  return (
    <NewShopsView
      state={view}
      busy={busy}
      feedback={feedback}
      search={{
        area,
        category,
        busy: searching,
        search,
        filtered: !!filterId,
        onArea: setArea,
        onCategory: setCategory,
        onSearch: () => void runSearch(),
        onShowResults: () => search && setFilterId(search.searchId),
        onShowAll: () => setFilterId(null),
      }}
      add={{ open: addOpen, form: addForm, busy: adding, onOpen: setAddOpen, onChange: setAddForm, onSubmit: () => void addShop() }}
      onRetry={() => void reload(false)}
      onAct={(c, a) => void act(c, a)}
      onOpenWeek={() => navigate("/rep/week")}
      onDismissFeedback={() => setFeedback(null)}
    />
  );
}
