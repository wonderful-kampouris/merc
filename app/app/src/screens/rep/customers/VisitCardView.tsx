import { Alert, Badge, Button, Card, Descriptions, Icon, Layout, Page, Skeleton, Text } from "@wonderful/ui-base";
import { ArrowLeftIcon, ArrowsClockwiseIcon, LinkIcon, PlusIcon, UserIcon } from "@phosphor-icons/react";
import { useState, type ReactNode } from "react";
import type { FunctionResponseMap, OrderSummary, VisitCard } from "../../../contracts";
import { useScreenI18n, type Lang } from "../../../lib/i18n";
import { formatMoney } from "../today/todayModel";
import ContactForm from "./ContactForm";
import {
  formatDate,
  formatQuantity,
  isHttpUrl,
  isRiskReasonCode,
  pitchArgumentCount,
  problemActions,
  riskLevel,
  sourceLabel,
  splitReasons,
  spokenSeconds,
  usualOrder,
  type ContactDraft,
} from "./customersModel";
import messages from "./i18n";
import SpeakButton from "./SpeakButton";

export type DetailsState = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; value: FunctionResponseMap["account-get"] };
export type Notice = { kind: "success" | "error"; text: string } | null;

export interface VisitCardViewProps {
  card: VisitCard;
  details: DetailsState | null;
  lang: Lang;
  mock: boolean;
  notice: Notice;
  /** Keys of actions in flight: `problem:<id>`, `order:<id>`. */
  busy: ReadonlySet<string>;
  onBack: () => void;
  onProblem: (problemId: string, status: "in_progress" | "resolved") => void;
  onAddContact: (d: ContactDraft) => Promise<boolean>;
  onReorder: (order: OrderSummary) => void;
  onDismissNotice: () => void;
}

type T = ReturnType<typeof useScreenI18n<keyof typeof messages.en>>["t"];
const RISK_COLOR = { none: "muted", low: "green", medium: "orange", high: "red" } as const;
const ORDER_COLOR = { draft: "neutral", confirmed: "green", cancelled: "muted" } as const;

function Section(props: { title: string; actions?: ReactNode; children: ReactNode; testId?: string }) {
  return (
    <Page.Section>
      <Card withHeaderDivider data-section={props.testId}>
        <Card.Header title={props.title} actions={props.actions} />
        {props.children}
      </Card>
    </Page.Section>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <Card.Content>
      <Text variant="sm" color="secondary">{text}</Text>
    </Card.Content>
  );
}

function Contacts({ card, t, onAdd }: { card: VisitCard; t: T; onAdd: (d: ContactDraft) => Promise<boolean> }) {
  const [adding, setAdding] = useState(false);
  return (
    <Section
      title={t("contacts")}
      testId="contacts"
      actions={
        adding ? undefined : (
          <Button size="small" variant="tertiary" prefix={<Icon icon={PlusIcon} />} onClick={() => setAdding(true)}>
            {t("addContact")}
          </Button>
        )
      }
    >
      {card.contacts.length ? (
        <Card.List>
          {card.contacts.map((c) => (
            <Card.List.Item key={c.contact_id}>
              <Card.Meta
                avatar={<Icon icon={UserIcon} />}
                title={c.full_name}
                description={[c.role_title, c.phone].filter(Boolean).join(" · ")}
                actions={c.is_decision_maker ? <Badge text={t("decisionMaker")} color="teal" size="small" /> : undefined}
              />
            </Card.List.Item>
          ))}
        </Card.List>
      ) : (
        <Empty text={t("noContacts")} />
      )}
      {adding ? (
        <Card.Content>
          <ContactForm
            onCancel={() => setAdding(false)}
            onSave={async (d) => {
              const ok = await onAdd(d);
              if (ok) setAdding(false);
              return ok;
            }}
          />
        </Card.Content>
      ) : null}
    </Section>
  );
}

function SpokenSummary({ card, t, lang }: { card: VisitCard; t: T; lang: Lang }) {
  const secs = spokenSeconds(card.spoken_summary);
  return (
    <Section
      title={t("summary")}
      testId="summary"
      actions={
        <Layout.Row gap="xs">
          <Badge text={t("seconds", { n: secs })} color={secs <= 30 ? "neutral" : "orange"} size="small" />
          <SpeakButton text={card.spoken_summary} lang={lang} listen={t("listen")} stop={t("stop")} />
        </Layout.Row>
      }
    >
      <Card.Content>
        <Text variant="md">{card.spoken_summary}</Text>
      </Card.Content>
    </Section>
  );
}

function CustomerSections({ card, t, lang, busy, onProblem, onReorder }: { card: VisitCard; t: T; lang: Lang; busy: ReadonlySet<string>; onProblem: VisitCardViewProps["onProblem"]; onReorder: VisitCardViewProps["onReorder"] }) {
  const level = riskLevel(card.metrics.risk_score);
  const reasons = splitReasons(card.metrics.risk_reasons);
  const usual = usualOrder(card.recent_orders);
  return (
    <>
      {card.how_to_talk ? (
        <Section title={t("howToTalk")} testId="how_to_talk">
          <Card.Content>
            <Text variant="md">{card.how_to_talk}</Text>
          </Card.Content>
        </Section>
      ) : null}

      <Section title={t("metrics")} testId="metrics" actions={<Badge text={`${t("risk")}: ${level === "none" ? t("risk.none") : t(`risk.${level}`)}${typeof card.metrics.risk_score === "number" ? ` · ${Math.round(card.metrics.risk_score)}` : ""}`} color={RISK_COLOR[level]} size="small" />}>
        <Card.Content>
          <Layout.Stack gap="sm">
            <Descriptions column={2} size="small">
              <Descriptions.Item label={t("usualInterval")}>
                {typeof card.metrics.avg_order_interval_days === "number" ? t("days", { n: Math.round(card.metrics.avg_order_interval_days) }) : "—"}
              </Descriptions.Item>
              <Descriptions.Item label={t("daysSince")}>
                {typeof card.metrics.days_since_last_order === "number" ? t("days", { n: Math.round(card.metrics.days_since_last_order) }) : "—"}
              </Descriptions.Item>
            </Descriptions>
            {usual.length ? (
              <Text variant="sm">
                <Text.Inline variant="sm" weight="medium">{t("usualOrder")}: </Text.Inline>
                {usual.map((u) => `${formatQuantity(u.quantity, u.unit, lang)} ${u.name}`).join(", ")}
              </Text>
            ) : null}
            {reasons.length ? (
              <Layout.Row gap="xs" wrap>
                {reasons.map((r) => (
                  <Badge key={r} text={isRiskReasonCode(r) ? t(`reason.${r}`) : r} color="orange" variant="outlined" size="small" />
                ))}
              </Layout.Row>
            ) : null}
          </Layout.Stack>
        </Card.Content>
      </Section>

      {card.alerts.length ? (
        <Section title={t("alerts")} testId="alerts">
          <Card.Content>
            <Layout.Stack gap="sm">
              {card.alerts.map((a) => (
                <Alert key={a.alert_id} variant="warning" size="compact" description={a.message} />
              ))}
            </Layout.Stack>
          </Card.Content>
        </Section>
      ) : null}

      <Section title={t("problems")} testId="problems">
        {card.open_problems.length ? (
          <Card.List>
            {card.open_problems.map((p) => (
              <Card.List.Item key={p.problem_id}>
                <Layout.Stack gap="xs">
                  <Text variant="md">{p.description}</Text>
                  <Layout.Row split wrap gap="xs">
                    <Layout.Row gap="xs">
                      <Badge text={["open", "in_progress", "resolved"].includes(p.status) ? t(`problem.${p.status as "open"}`) : p.status} color={p.status === "in_progress" ? "blue" : "orange"} size="small" />
                      {p.due_date ? <Text variant="sm" color="secondary">{t("due", { date: formatDate(p.due_date, lang) })}</Text> : null}
                    </Layout.Row>
                    <Layout.Row gap="xs">
                      {problemActions(p.status).map((s) => (
                        <Button key={s} size="small" variant={s === "resolved" ? "primary" : "secondary"} loading={busy.has(`problem:${p.problem_id}`)} onClick={() => onProblem(p.problem_id, s)}>
                          {t(s === "resolved" ? "markResolved" : "markInProgress")}
                        </Button>
                      ))}
                    </Layout.Row>
                  </Layout.Row>
                </Layout.Stack>
              </Card.List.Item>
            ))}
          </Card.List>
        ) : (
          <Empty text={t("noProblems")} />
        )}
      </Section>

      <Section title={t("tasks")} testId="tasks">
        {card.open_tasks.length ? (
          <Card.List>
            {card.open_tasks.map((k) => (
              <Card.List.Item key={k.task_id}>
                <Card.Meta
                  title={k.title}
                  description={k.due_at ? t("due", { date: formatDate(k.due_at, lang) }) : undefined}
                  actions={k.is_customer_promise ? <Badge text={t("promise")} color="purple" size="small" /> : undefined}
                />
              </Card.List.Item>
            ))}
          </Card.List>
        ) : (
          <Empty text={t("noTasks")} />
        )}
      </Section>

      <Section title={t("orders")} testId="orders">
        {card.recent_orders.length ? (
          <Card.List>
            {card.recent_orders.map((o, i) => (
              <Card.List.Item key={`${o.order_id}:${i}`}>
                <Layout.Stack gap="xs">
                  <Layout.Row split gap="xs">
                    <Text variant="md" weight="medium">{formatDate(o.order_date, lang)} · {formatMoney(o.total_minor, lang)}</Text>
                    <Badge text={t(`order.${o.status}`)} color={ORDER_COLOR[o.status]} size="small" />
                  </Layout.Row>
                  <Text variant="sm" color="secondary">{o.lines.map((l) => `${formatQuantity(l.quantity, l.unit, lang)} ${l.name}`).join(", ")}</Text>
                  {i === 0 && o.lines.length ? (
                    <Layout.Row gap="xs">
                      <Button size="small" variant="secondary" prefix={<Icon icon={ArrowsClockwiseIcon} />} loading={busy.has(`order:${o.order_id}`)} onClick={() => onReorder(o)}>
                        {t("reorder")}
                      </Button>
                    </Layout.Row>
                  ) : null}
                </Layout.Stack>
              </Card.List.Item>
            ))}
          </Card.List>
        ) : (
          <Empty text={t("noOrders")} />
        )}
      </Section>
    </>
  );
}

function ProspectSections({ card, t, lang }: { card: VisitCard; t: T; lang: Lang }) {
  const d = card.dossier;
  const n = pitchArgumentCount(card);
  return (
    <>
      <Section title={t("dossier")} testId="dossier" actions={d?.price_level ? <Badge text={t("priceLevel", { level: t(`price.${d.price_level}`) })} size="small" /> : undefined}>
        <Card.Content>
          <Layout.Stack gap="sm">
            {d?.summary ? <Text variant="md">{d.summary}</Text> : null}
            <Text variant="sm" weight="medium">{t("competitors")}</Text>
            {d?.competitor_brands.length ? (
              <Layout.Row gap="xs" wrap>
                {d.competitor_brands.map((b) => (
                  <Badge key={b} text={b} color="red" variant="outlined" size="small" />
                ))}
              </Layout.Row>
            ) : (
              <Text variant="sm" color="secondary">{t("noCompetitors")}</Text>
            )}
          </Layout.Stack>
        </Card.Content>
      </Section>

      <Section title={t("facts")} testId="facts">
        {d?.facts.length ? (
          <Card.List>
            {d.facts.map((f, i) => (
              <Card.List.Item key={`${f.fact_type}:${i}`}>
                <Layout.Stack gap="xs">
                  <Text variant="md">{f.value}</Text>
                  <Layout.Row gap="xs" wrap>
                    <Badge text={f.fact_type} size="small" variant="outlined" />
                    {isHttpUrl(f.source_url) ? (
                      <a href={f.source_url} target="_blank" rel="noreferrer noopener">
                        <Layout.Row gap="xs">
                          <Icon icon={LinkIcon} />
                          <Text.Inline variant="sm" color="info">{sourceLabel(f.source_url)}</Text.Inline>
                        </Layout.Row>
                      </a>
                    ) : (
                      <Text variant="sm" color="secondary">{f.source_url}</Text>
                    )}
                    <Text variant="sm" color="tertiary">{formatDate(f.retrieved_at, lang)}</Text>
                  </Layout.Row>
                </Layout.Stack>
              </Card.List.Item>
            ))}
          </Card.List>
        ) : (
          <Empty text={t("noFacts")} />
        )}
      </Section>

      <Section title={t("pitch")} testId="pitch">
        {card.pitch ? (
          <Card.Content>
            <Layout.Stack gap="md">
              <Layout.Stack gap="xs">
                <Text variant="sm" color="secondary">{t("opening")}</Text>
                <Text variant="md" weight="medium">{card.pitch.opening_line}</Text>
              </Layout.Stack>
              <Layout.Stack gap="xs">
                <Text variant="sm" color="secondary">{t("arguments")}</Text>
                {card.pitch.arguments.map((a, i) => (
                  <Text key={i} variant="md">{i + 1}. {a}</Text>
                ))}
                {n !== 3 ? <Text variant="sm" color="warning">{t("argumentsCount", { n: n ?? 0 })}</Text> : null}
              </Layout.Stack>
              {card.pitch.products.length ? (
                <Layout.Stack gap="xs">
                  <Text variant="sm" color="secondary">{t("pitchProducts")}</Text>
                  {card.pitch.products.map((p, i) => (
                    <Text key={`${p.product_id}:${i}`} variant="sm"><Text.Inline variant="sm" weight="medium">{p.name}</Text.Inline> — {p.why}</Text>
                  ))}
                </Layout.Stack>
              ) : null}
            </Layout.Stack>
          </Card.Content>
        ) : (
          <Empty text={t("noPitch")} />
        )}
      </Section>

      {card.pitch?.objections.length ? (
        <Section title={t("objections")} testId="objections">
          <Card.List>
            {card.pitch.objections.map((o, i) => (
              <Card.List.Item key={i}>
                <Layout.Stack gap="xs">
                  <Text variant="md" weight="medium">“{o.objection}”</Text>
                  <Text variant="sm" color="secondary">{o.answer}</Text>
                </Layout.Stack>
              </Card.List.Item>
            ))}
          </Card.List>
        </Section>
      ) : null}
    </>
  );
}

function Products({ card, t }: { card: VisitCard; t: T }) {
  return (
    <>
      {card.suggested_products.length ? (
        <Section title={t("suggested")} testId="suggested">
          <Card.List>
            {card.suggested_products.map((p, i) => (
              <Card.List.Item key={`${p.product_id}:${i}`}>
                <Card.Meta title={p.name} description={p.why} truncateDescription={false} />
              </Card.List.Item>
            ))}
          </Card.List>
        </Section>
      ) : null}
      {card.campaigns.length ? (
        <Section title={t("campaigns")} testId="campaigns">
          <Card.List>
            {card.campaigns.map((c) => (
              <Card.List.Item key={c.campaign_id}>
                <Card.Meta title={c.title} description={c.message} truncateDescription={false} />
              </Card.List.Item>
            ))}
          </Card.List>
        </Section>
      ) : null}
    </>
  );
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

function Details({ details, t, lang }: { details: DetailsState; t: T; lang: Lang }) {
  if (details.status === "loading") {
    return (
      <Page.Section>
        <Skeleton height={96} radius="lg" />
      </Page.Section>
    );
  }
  if (details.status === "error") {
    return (
      <Page.Section>
        <Alert variant="neutral" size="compact" title={t("detailsError")} description={details.message} />
      </Page.Section>
    );
  }
  const a = details.value.account as Record<string, unknown>;
  const address = [str(a.street), str(a.postal_code), str(a.city)].filter(Boolean).join(", ");
  const deals = details.value.deals.filter((d) => !(d as Record<string, unknown>).closed_at);
  const rows: Array<[string, ReactNode]> = [];
  if (str(a.phone)) rows.push([t("phone"), <a href={`tel:${str(a.phone)}`}>{str(a.phone)}</a>]);
  if (str(a.email)) rows.push([t("email"), <a href={`mailto:${str(a.email)}`}>{str(a.email)}</a>]);
  if (address) rows.push([t("address"), address]);
  if (str(a.website)) rows.push([t("website"), str(a.website)]);
  if (str(a.customer_since)) rows.push([t("customerSince"), formatDate(str(a.customer_since)!, lang)]);
  return (
    <Section title={t("details")} testId="details">
      {rows.length ? (
        <Card.Content>
          <Descriptions column={1} size="small">
            {rows.map(([label, value]) => (
              <Descriptions.Item key={label} label={label}>{value}</Descriptions.Item>
            ))}
          </Descriptions>
        </Card.Content>
      ) : null}
      {deals.length ? (
        <Card.List>
          {deals.map((d, i) => {
            const r = d as Record<string, unknown>;
            return (
              <Card.List.Item key={String(r.id ?? i)}>
                <Card.Meta
                  title={str(r.title) ?? t("deals")}
                  description={[str(r.stage_code), typeof r.amount_minor === "number" ? formatMoney(r.amount_minor, lang) : null, str(r.expected_close_date) ? formatDate(str(r.expected_close_date)!, lang) : null].filter(Boolean).join(" · ")}
                />
              </Card.List.Item>
            );
          })}
        </Card.List>
      ) : null}
    </Section>
  );
}

/** The visit card: customer view (REQ-CRD-001) or prospect view (REQ-CRD-002), plus account details and quick edits. */
export default function VisitCardView(props: VisitCardViewProps) {
  const { t } = useScreenI18n(messages);
  const { card, lang } = props;
  const where = [card.account.city, card.account.postal_code].filter(Boolean).join(" · ");
  return (
    <Page width="small">
      <Page.Header
        title={card.account.name}
        description={where || undefined}
        actions={
          <Layout.Row gap="xs">
            {props.mock ? <Badge text={t("badge.mock")} color="purple" size="small" /> : null}
            <Badge text={t(card.kind)} color={card.kind === "prospect" ? "blue" : "green"} size="small" />
          </Layout.Row>
        }
      />
      <Page.Section>
        <Layout.Row>
          <Button variant="tertiary" size="small" prefix={<Icon icon={ArrowLeftIcon} />} onClick={props.onBack}>
            {t("back")}
          </Button>
        </Layout.Row>
      </Page.Section>
      {props.notice ? (
        <Page.Section>
          <Alert variant={props.notice.kind === "success" ? "success" : "error"} size="compact" description={props.notice.text} isClosable onClose={props.onDismissNotice} />
        </Page.Section>
      ) : null}
      <SpokenSummary card={card} t={t} lang={lang} />
      {card.kind === "prospect" ? (
        <ProspectSections card={card} t={t} lang={lang} />
      ) : (
        <CustomerSections card={card} t={t} lang={lang} busy={props.busy} onProblem={props.onProblem} onReorder={props.onReorder} />
      )}
      <Products card={card} t={t} />
      <Contacts card={card} t={t} onAdd={props.onAddContact} />
      {props.details ? <Details details={props.details} t={t} lang={lang} /> : null}
    </Page>
  );
}
