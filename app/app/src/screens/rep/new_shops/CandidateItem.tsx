import { Alert, Badge, Button, Card, Layout, Text } from "@wonderful/ui-base";
import type { CandidateCard } from "../../../contracts";
import { useScreenI18n } from "../../../lib/i18n";
import messages from "./i18n";
import { canAdd, canDismiss, formatScore, getHost, isKnownStatus, STATUS_COLOR } from "./logic";

export type CandidateAction = "add_to_route" | "dismiss";

export interface CandidateItemProps {
  candidate: CandidateCard;
  busy?: CandidateAction;
  onAct: (c: CandidateCard, action: CandidateAction) => void;
}

/** One candidate shop: score, top reasons, dossier facts with their sources, and add-to-route (REQ-PRS-006). */
export default function CandidateItem({ candidate: c, busy, onAct }: CandidateItemProps) {
  const { t } = useScreenI18n(messages);
  const d = c.dossier;
  const where = [c.postal_code, c.website ? getHost(c.website) : null].filter(Boolean).join(" · ");
  const actions = canAdd(c) || canDismiss(c);

  return (
    <Card withFooterDivider>
      <Card.Header
        title={c.business_name}
        description={where || undefined}
        actions={
          <Layout.Row gap="xs">
            {c.score !== null && c.score !== undefined ? <Badge text={t("score", { n: formatScore(c.score) })} color="green" size="small" /> : null}
            {isKnownStatus(c.status) ? <Badge text={t(`status.${c.status}`)} color={STATUS_COLOR[c.status]} size="small" variant="outlined" /> : null}
          </Layout.Row>
        }
      />
      <Card.Content>
        <Layout.Stack gap="sm">
          {c.duplicate_of ? <Alert variant="warning" size="compact" title={t("duplicateOf", { name: c.duplicate_of.name })} /> : null}
          {c.reasons.length ? (
            <Layout.Stack gap="xs">
              {c.reasons.slice(0, 3).map((r, i) => (
                <Text key={i} variant="sm">
                  {`• ${r}`}
                </Text>
              ))}
            </Layout.Stack>
          ) : null}
          {d?.summary ? <Text variant="md">{d.summary}</Text> : null}
          {d?.price_level || d?.competitor_brands.length ? (
            <Layout.Row gap="xs" wrap>
              {d.price_level ? <Badge text={t(`price.${d.price_level}`)} size="small" color="muted" /> : null}
              {d.competitor_brands.length ? <Badge text={t("competitors", { brands: d.competitor_brands.join(", ") })} size="small" color="orange" variant="outlined" /> : null}
            </Layout.Row>
          ) : null}
          {d?.facts.slice(0, 3).map((f, i) => (
            <Layout.Stack key={i} gap="none">
              <Text variant="sm">{f.value}</Text>
              <Text variant="sm" color="tertiary">
                {t("source", { host: getHost(f.source_url) })}
              </Text>
            </Layout.Stack>
          ))}
          {c.assigned_rep ? (
            <Text variant="sm" color="secondary">
              {t("assigned", { name: c.assigned_rep.full_name })}
            </Text>
          ) : null}
        </Layout.Stack>
      </Card.Content>
      {actions ? (
        <Card.Footer>
          <Layout.Row gap="sm" wrap>
            {canAdd(c) ? (
              <Button variant="primary" size="small" loading={busy === "add_to_route"} disabled={!!busy} onClick={() => onAct(c, "add_to_route")}>
                {t("act.add")}
              </Button>
            ) : null}
            {canDismiss(c) ? (
              <Button variant="tertiary" size="small" loading={busy === "dismiss"} disabled={!!busy} onClick={() => onAct(c, "dismiss")}>
                {t("act.dismiss")}
              </Button>
            ) : null}
          </Layout.Row>
        </Card.Footer>
      ) : null}
    </Card>
  );
}
