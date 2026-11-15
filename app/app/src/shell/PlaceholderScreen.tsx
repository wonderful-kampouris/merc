import { Badge, Button, Card, Layout, Page, Text } from "@wonderful/ui-base";
import { useState } from "react";
import { functionContract, type FunctionSlug } from "../contracts";
import AppBoundary from "../AppBoundary";
import { MercApiError } from "../lib/client";
import { screenTitleKey, useI18n, type MessageKey } from "../lib/i18n";
import type { Screen } from "../lib/routes";
import type { ScreenProps } from "../lib/screenRegistry";
import { useLive } from "../lib/useLive";

/** A function of the screen that can be called with an empty body (GET/POST, no required fields). */
export function sampleSlug(screen: Screen): FunctionSlug | undefined {
  return screen.functions.find((f) => {
    const c = functionContract(f as FunctionSlug) as { method: string; request?: { required?: string[] } };
    return c.method !== "WS" && !(c.request?.required?.length);
  }) as FunctionSlug | undefined;
}

const LIVE_LABEL: Record<string, MessageKey> = { connecting: "live.connecting", socket: "live.socket", polling: "live.polling" };

/** Fallback for every app.json route whose src/screens/<shell>/<screen>/index.tsx does not exist yet. */
export default function PlaceholderScreen(props: ScreenProps) {
  const { screen, client } = props;
  const { t } = useI18n();
  const sample = sampleSlug(screen);
  const [sampleState, setSampleState] = useState<{ busy: boolean; text?: string; error?: boolean }>({ busy: false });
  const live = useLive({ types: screen.events, openSocket: props.openLiveSocket });

  const runSample = async () => {
    if (!sample) return;
    setSampleState({ busy: true });
    try {
      const result = await client.call(sample, {} as never);
      setSampleState({ busy: false, text: JSON.stringify(result, null, 2).slice(0, 1200) });
    } catch (e) {
      setSampleState({ busy: false, error: true, text: e instanceof MercApiError ? `${e.code}: ${e.message}` : String(e) });
    }
  };

  return (
    <Page width={screen.shell === "rep" ? "small" : "full"}>
      <Page.Header
        title={t(screenTitleKey(screen.shell, screen.key))}
        description={screen.route}
        actions={
          <Layout.Row gap="xs" wrap>
            {screen.offline ? <Badge text={t("badge.offline")} color="teal" size="small" /> : null}
            {live ? <Badge text={t(LIVE_LABEL[live]!)} color={live === "socket" ? "green" : "orange"} isDot={live === "socket"} size="small" /> : null}
          </Layout.Row>
        }
      />
      <Page.Section>
        <AppBoundary>
          <Card>
            <Card.Header title={t("placeholder.title")} />
            <Card.Content>
              <Layout.Stack gap="md">
                <Text variant="body-sm" color="secondary">
                  {t("placeholder.body")}
                </Text>
                <Layout.Stack gap="xs">
                  <Text variant="body-sm">{t("placeholder.functions")}</Text>
                  <Layout.Row gap="xs" wrap>
                    {screen.functions.map((f) => (
                      <Badge key={f} text={f} variant="outlined" size="small" />
                    ))}
                  </Layout.Row>
                </Layout.Stack>
                {screen.events.length ? (
                  <Layout.Stack gap="xs">
                    <Text variant="body-sm">{t("placeholder.events")}</Text>
                    <Layout.Row gap="xs" wrap>
                      {screen.events.map((e) => (
                        <Badge key={e} text={e} color="blue" variant="outlined" size="small" />
                      ))}
                    </Layout.Row>
                  </Layout.Stack>
                ) : null}
                {sample ? (
                  <Layout.Stack gap="sm">
                    <Layout.Row gap="sm" wrap>
                      <Button size="small" onClick={() => void runSample()} loading={sampleState.busy}>
                        {t("placeholder.sample")}: {sample}
                      </Button>
                      {client.mock ? <Badge text={t("badge.mock")} color="purple" size="small" /> : null}
                    </Layout.Row>
                    {sampleState.text ? (
                      <Text as="span" variant="body-sm" color={sampleState.error ? "danger" : "secondary"} code className="merc-pre">
                        {sampleState.text}
                      </Text>
                    ) : null}
                  </Layout.Stack>
                ) : (
                  <Text variant="body-sm" color="secondary">
                    {t("placeholder.noSample")}
                  </Text>
                )}
              </Layout.Stack>
            </Card.Content>
          </Card>
        </AppBoundary>
      </Page.Section>
    </Page>
  );
}
