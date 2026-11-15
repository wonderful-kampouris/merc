import { StorefrontIcon } from "@phosphor-icons/react";
import { Button, EmptyState, Icon, Layout, Page, Text } from "@wonderful/ui-base";
import type { CandidateCard } from "../../../contracts";
import { screenTitleKey, useScreenI18n } from "../../../lib/i18n";
import ErrorState from "../approvals/kit/ErrorState";
import Feedback, { type FeedbackMessage } from "../approvals/kit/Feedback";
import LoadingState from "../approvals/kit/LoadingState";
import type { ResourceState } from "../approvals/kit/useResource";
import AddShopCard, { type AddShopCardProps } from "./AddShopCard";
import CandidateItem, { type CandidateAction } from "./CandidateItem";
import messages from "./i18n";
import { getVisible } from "./logic";
import SearchCard, { type SearchCardProps } from "./SearchCard";

export interface NewShopsViewProps {
  state: ResourceState<CandidateCard[]>;
  busy: Readonly<Record<string, CandidateAction>>;
  feedback: (FeedbackMessage & { week?: boolean }) | null;
  search: SearchCardProps;
  add: AddShopCardProps;
  onRetry: () => void;
  onAct: (c: CandidateCard, action: CandidateAction) => void;
  onOpenWeek: () => void;
  onDismissFeedback: () => void;
}

/** Rep prospecting: search an area, add a spotted shop, review scored candidates and add them to the route. */
export default function NewShopsView(p: NewShopsViewProps) {
  const { t } = useScreenI18n(messages);
  const items = p.state.status === "ready" ? getVisible(p.state.data) : [];
  return (
    <Page width="small">
      <Page.Header title={t(screenTitleKey("rep", "new_shops"))} />
      <Page.Section>
        <Layout.Stack gap="md">
          <Text variant="sm" color="secondary">
            {t("intro")}
          </Text>
          <SearchCard {...p.search} />
          <AddShopCard {...p.add} />
          <Feedback
            message={p.feedback}
            onClose={p.onDismissFeedback}
            action={
              p.feedback?.week ? (
                <Button size="small" onClick={p.onOpenWeek}>
                  {t("openWeek")}
                </Button>
              ) : undefined
            }
          />
          {p.state.status === "loading" ? <LoadingState /> : null}
          {p.state.status === "error" ? <ErrorState error={p.state.error} onRetry={p.onRetry} /> : null}
          {p.state.status === "ready" && !items.length ? (
            <EmptyState icon={<Icon icon={StorefrontIcon} />} title={t("empty.title")} description={t("empty.body")} />
          ) : null}
          {items.map((c) => (
            <CandidateItem key={c.candidate_id} candidate={c} busy={p.busy[c.candidate_id]} onAct={p.onAct} />
          ))}
        </Layout.Stack>
      </Page.Section>
    </Page>
  );
}
