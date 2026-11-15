import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import { Button, Card, Icon, InputText, Layout, Notice } from "@wonderful/ui-base";
import { useScreenI18n } from "../../../lib/i18n";
import messages from "./i18n";
import type { ReadySummary } from "./logic";

export interface SearchState {
  searchId: string;
  area: string;
  ready?: ReadySummary;
}

export interface SearchCardProps {
  area: string;
  category: string;
  busy: boolean;
  search: SearchState | null;
  filtered: boolean;
  onArea: (v: string) => void;
  onCategory: (v: string) => void;
  onSearch: () => void;
  onShowResults: () => void;
  onShowAll: () => void;
}

/** Area + shop type search (fn:prospect-search); progress arrives as candidates.ready. */
export default function SearchCard(p: SearchCardProps) {
  const { t } = useScreenI18n(messages);
  return (
    <Card>
      <Card.Header title={t("search.title")} />
      <Card.Content>
        <Layout.Stack gap="sm">
          <InputText label={t("search.area")} placeholder={t("search.areaPh")} value={p.area} onChange={(e) => p.onArea(e.target.value)} />
          <InputText label={t("search.category")} placeholder={t("search.categoryPh")} value={p.category} onChange={(e) => p.onCategory(e.target.value)} />
          <Layout.Row gap="sm" wrap>
            <Button variant="primary" prefix={<Icon icon={MagnifyingGlassIcon} />} loading={p.busy} disabled={!p.area.trim()} onClick={p.onSearch}>
              {t("search.go")}
            </Button>
            {p.search && !p.filtered ? (
              <Button variant="tertiary" onClick={p.onShowResults}>
                {t("search.showResults")}
              </Button>
            ) : null}
            {p.filtered ? (
              <Button variant="tertiary" onClick={p.onShowAll}>
                {t("search.showAll")}
              </Button>
            ) : null}
          </Layout.Row>
          {p.search ? (
            <Notice
              size="compact"
              variant={p.search.ready ? "neutral" : "info"}
              description={p.search.ready ? t("search.ready", { ...p.search.ready }) : t("search.running", { area: p.search.area })}
            />
          ) : null}
        </Layout.Stack>
      </Card.Content>
    </Card>
  );
}
