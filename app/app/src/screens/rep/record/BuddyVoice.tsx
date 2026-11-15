import { Alert, Button, Card, Icon, Layout, Notice } from "@wonderful/ui-base";
import { HeadsetIcon } from "@phosphor-icons/react";
import { useWonderful } from "@wonderful/app-sdk";
import { useEffect, useRef, useState } from "react";
import messages from "./i18n";
import { useScreenI18n } from "../../../lib/i18n";
import { buddyConfig, openBuddy, type ChatHandle } from "./buddy";
import { toSdkToken, type TokenSource } from "./token";

export type BuddyState = "idle" | "opening" | "open" | "error";

/** Keeps the Chat SDK handle for the page's life so switching tabs inside the app does not end the call (spike S2). */
let sharedChat: ChatHandle | null = null;

/**
 * merc-buddy in browser-voice mode (REQ-BUD-001), authenticated with the signed user token from fn:merc-chat-token
 * (REQ-BUD-002). The mic is asked only when the rep taps "Start a call" inside the widget.
 */
export default function BuddyVoice({ source, online, lang }: { source: TokenSource; online: boolean; lang: "el" | "en" }) {
  const { t } = useScreenI18n(messages);
  const { context } = useWonderful();
  const host = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<BuddyState>(sharedChat ? "open" : "idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => () => sharedChat?.setState({ open: false }), []);

  const open = async () => {
    if (!source.ok || !host.current) return;
    if (sharedChat) {
      sharedChat.setState({ open: true });
      setState("open");
      return;
    }
    setState("opening");
    setError(null);
    try {
      const first = await source.fetch();
      const cfg = buddyConfig({ token: toSdkToken(first, source.fetch), agentId: first.agent_id, baseUrl: context?.apiBaseUrl, lang, title: "Merc" });
      sharedChat = await openBuddy(cfg, host.current);
      setState("open");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setState("error");
    }
  };

  const notice = !source.ok ? (source.reason === "mock" ? t("buddy.mock") : t("buddy.notListed")) : !online ? t("buddy.offline") : null;

  return (
    <Card data-testid="buddy">
      <Card.Header icon={<Icon icon={HeadsetIcon} />} title={t("buddy.title")} description={t("buddy.desc")} />
      <Card.Content>
        <Layout.Stack gap="sm">
          {notice ? (
            <Notice variant={source.ok ? "warning" : "info"} size="compact" description={notice} />
          ) : (
            <Button className="w-full" onClick={() => void open()} loading={state === "opening"} prefix={<Icon icon={HeadsetIcon} />}>
              {state === "opening" ? t("buddy.opening") : t("buddy.open")}
            </Button>
          )}
          {state === "open" ? <Notice variant="neutral" size="compact" description={t("buddy.connected")} /> : null}
          {state === "error" && error ? <Alert variant="error" size="compact" description={t("buddy.error", { msg: error })} /> : null}
          <div ref={host} className="merc-record__buddy-host" />
        </Layout.Stack>
      </Card.Content>
    </Card>
  );
}
