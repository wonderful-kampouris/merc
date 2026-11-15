import { Alert, Badge, Button, Card, Icon, Layout, Notice, Page, Spinner, Text, TextArea } from "@wonderful/ui-base";
import { MicrophoneIcon, StopIcon, TextAaIcon } from "@phosphor-icons/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MercApiError } from "../../../lib/client";
import { useScreenI18n } from "../../../lib/i18n";
import type { ScreenProps } from "../../../lib/screenRegistry";
import { useLive } from "../../../lib/useLive";
import BuddyVoice from "./BuddyVoice";
import messages from "./i18n";
import QueueList from "./QueueList";
import {
  applyVoiceLogStatus,
  createItem,
  flushQueue,
  localQueueStore,
  markReady,
  pendingCount,
  pruneQueue,
  removeItem,
  retryItem,
  type QueueItem,
} from "./queue";
import { formatDuration, recordingSupported, startRecording, type RecorderHandle } from "./recorder";
import ResultCardView from "./ResultCardView";
import { applyUndo, type ResultCard } from "./resultCard";
import { tokenSource } from "./token";

/** REQ-NFR-001: the card should be visible within 25 s of stopping the recording; after that we say it is slow. */
const SLOW_MS = 25_000;
const RESYNC_MS = 30_000;

const errText = (e: unknown) => (e instanceof MercApiError ? `${e.code}: ${e.message}` : e instanceof Error ? e.message : String(e));
const isOnline = () => (typeof navigator === "undefined" ? true : navigator.onLine !== false);

/** Rep Record screen: buddy voice, in-app recording with an offline queue, and the result card with undo. */
export default function Record({ screen, client, openLiveSocket, lang }: ScreenProps) {
  const { t } = useScreenI18n(messages);
  const store = useMemo(() => localQueueStore(), []);
  const [items, setItemsState] = useState<QueueItem[]>(() => pruneQueue(store.load()));
  const itemsRef = useRef(items);
  const [persisted, setPersisted] = useState(true);
  const [online, setOnline] = useState(isOnline);
  const [syncing, setSyncing] = useState(false);
  const [card, setCard] = useState<ResultCard | null>(null);
  const [waitingFor, setWaitingFor] = useState<{ id: string; since: number } | null>(null);
  const [slow, setSlow] = useState(false);
  const [cardError, setCardError] = useState<string | null>(null);
  const [undoing, setUndoing] = useState<string | null>(null);
  const [undoError, setUndoError] = useState<string | null>(null);
  const [rec, setRec] = useState<{ handle: RecorderHandle; started: number } | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [recError, setRecError] = useState<string | null>(null);
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState("");
  const [savedNote, setSavedNote] = useState(false);
  const flushing = useRef(false);

  const setItems = useCallback(
    (next: QueueItem[]) => {
      itemsRef.current = next;
      setItemsState(next);
      setPersisted(store.save(next));
    },
    [store],
  );

  /* ---------- result card ---------- */
  const fetchCard = useCallback(
    async (voiceLogId: string) => {
      try {
        const c = await client.call("debrief-result-get", { voice_log_id: voiceLogId });
        setItems(markReady(itemsRef.current, voiceLogId));
        setCard(c);
        setCardError(null);
        setWaitingFor((w) => (w?.id === voiceLogId ? null : w));
      } catch (e) {
        // not_found = the debrief is still processing; keep waiting (live event or the next poll).
        if (e instanceof MercApiError && e.code === "not_found") return;
        setCardError(errText(e));
      }
    },
    [client, setItems],
  );

  const wait = useCallback(
    (voiceLogId: string) => {
      setCard(null);
      setUndoError(null);
      setCardError(null);
      setSlow(false);
      setWaitingFor({ id: voiceLogId, since: Date.now() });
      void fetchCard(voiceLogId);
    },
    [fetchCard],
  );

  useEffect(() => {
    if (!waitingFor) return;
    const left = SLOW_MS - (Date.now() - waitingFor.since);
    const timer = setTimeout(() => setSlow(true), Math.max(0, left));
    return () => clearTimeout(timer);
  }, [waitingFor]);

  /* ---------- offline queue ---------- */
  const flush = useCallback(async () => {
    if (flushing.current) return;
    flushing.current = true;
    setSyncing(true);
    const before = new Set(itemsRef.current.filter((i) => i.voice_log_id).map((i) => i.idempotency_key));
    try {
      const res = await flushQueue(itemsRef.current, (req) => client.call("voice-log-upload", req), {
        online: isOnline(),
        onChange: setItems,
      });
      setItems(res.items);
      const fresh = res.items.filter((i) => i.voice_log_id && !before.has(i.idempotency_key) && i.status === "processing");
      const newest = fresh.sort((a, b) => b.recorded_at.localeCompare(a.recorded_at))[0];
      if (newest?.voice_log_id) wait(newest.voice_log_id);
    } finally {
      flushing.current = false;
      setSyncing(false);
    }
  }, [client, setItems, wait]);

  useEffect(() => {
    const up = () => {
      setOnline(true);
      void flush();
    };
    const down = () => setOnline(false);
    globalThis.addEventListener?.("online", up);
    globalThis.addEventListener?.("offline", down);
    void flush();
    const timer = setInterval(() => {
      if (pendingCount(itemsRef.current)) void flush();
    }, RESYNC_MS);
    return () => {
      globalThis.removeEventListener?.("online", up);
      globalThis.removeEventListener?.("offline", down);
      clearInterval(timer);
    };
  }, [flush]);

  const enqueue = (input: Parameters<typeof createItem>[0]) => {
    try {
      const item = createItem({ ...input, language: lang });
      setItems([...itemsRef.current, item]);
      setSavedNote(!isOnline());
      void flush();
    } catch (e) {
      setRecError(errText(e) === "recording too large" ? t("rec.tooLarge") : errText(e));
    }
  };

  /* ---------- live events (poll while the socket is down) ---------- */
  const live = useLive({
    types: screen.events,
    openSocket: openLiveSocket,
    poll: () => {
      if (waitingFor) void fetchCard(waitingFor.id);
    },
    onEvent: (e) => {
      if (e.type === "result_card.ready") {
        const p = e.payload as { voice_log_id: string; result: ResultCard };
        // Events on rep:{me} are the rep's own debriefs. One logged through the buddy (call, WhatsApp, the voice
        // widget) is not in the upload queue; show it unless the screen is waiting for a different upload.
        if (itemsRef.current.some((i) => i.voice_log_id === p.voice_log_id)) setItems(markReady(itemsRef.current, p.voice_log_id));
        if (!waitingFor || waitingFor.id === p.voice_log_id) {
          setCard(p.result);
          setWaitingFor(null);
        }
      } else if (e.type === "voice_log.status") {
        const p = e.payload as { voice_log_id: string; status: string; error?: string | null };
        setItems(applyVoiceLogStatus(itemsRef.current, p.voice_log_id, p.status, p.error));
        if (p.status === "failed" && waitingFor?.id === p.voice_log_id) {
          setWaitingFor(null);
          setCardError(p.error ?? "failed");
        }
      }
    },
  });

  /* ---------- undo ---------- */
  const undo = async (aiActionId: string) => {
    setUndoing(aiActionId);
    setUndoError(null);
    try {
      await client.call("ai-action-undo", { ai_action_id: aiActionId });
      setCard((c) => (c ? applyUndo(c, aiActionId) : c));
    } catch (e) {
      setUndoError(errText(e));
    } finally {
      setUndoing(null);
    }
  };

  /* ---------- recording ---------- */
  useEffect(() => {
    if (!rec) return;
    const timer = setInterval(() => setElapsed(Date.now() - rec.started), 250);
    return () => clearInterval(timer);
  }, [rec]);

  const stopRef = useRef<() => void>(() => undefined);
  const start = async () => {
    setRecError(null);
    setSavedNote(false);
    if (!recordingSupported()) {
      setRecError(t("rec.unsupported"));
      setTyping(true);
      return;
    }
    try {
      const handle = await startRecording(() => stopRef.current());
      setElapsed(0);
      setRec({ handle, started: Date.now() });
    } catch (e) {
      const name = (e as { name?: string })?.name;
      setRecError(name === "NotAllowedError" || name === "SecurityError" ? t("rec.denied") : errText(e));
    }
  };
  const stop = async () => {
    if (!rec) return;
    const r = rec;
    setRec(null);
    try {
      const audio = await r.handle.stop();
      enqueue({ audio_base64: audio.base64, audio_mime: audio.mime, duration_ms: audio.durationMs });
    } catch (e) {
      setRecError(errText(e));
    }
  };
  stopRef.current = () => void stop();
  const cancel = () => {
    rec?.handle.cancel();
    setRec(null);
  };
  const sendText = () => {
    if (!text.trim()) return;
    enqueue({ transcript: text });
    setText("");
    setTyping(false);
  };

  const source = tokenSource({ functions: screen.functions, mock: client.mock, call: () => client.call("merc-chat-token", {}) });
  const pending = pendingCount(items);

  return (
    <Page width="small">
      <Page.Header
        title={t("title")}
        description={t("subtitle")}
        actions={
          <Layout.Row gap="xs" wrap>
            {!online ? <Badge text={t("live.off")} color="orange" size="small" /> : null}
            {client.mock ? <Badge text={t("badge.mock")} color="purple" size="small" /> : null}
            {live === "socket" ? <Badge text={t("live.socket")} color="green" isDot size="small" /> : null}
          </Layout.Row>
        }
      />
      <Page.Section>
        <Layout.Stack gap="lg">
          {waitingFor && !card ? (
            <Card data-testid="card-waiting">
              <Card.Content>
                <Layout.Stack gap="sm">
                  <Layout.Row gap="sm">
                    <Spinner size="small" />
                    <Text variant="body-sm">{t("card.waiting")}</Text>
                  </Layout.Row>
                  {slow ? <Notice variant="warning" size="compact" description={t("card.slow")} /> : null}
                </Layout.Stack>
              </Card.Content>
            </Card>
          ) : null}
          {cardError ? (
            <Alert
              variant="error"
              size="compact"
              description={t("card.loadFailed", { msg: cardError })}
              action={waitingFor ? <Button size="small" variant="secondary" onClick={() => void fetchCard(waitingFor.id)}>{t("queue.retry")}</Button> : undefined}
            />
          ) : null}
          {card ? <ResultCardView card={card} undoing={undoing} undoError={undoError} onUndo={(id) => void undo(id)} onClose={() => setCard(null)} /> : null}

          <Card data-testid="recorder">
            <Card.Header icon={<Icon icon={MicrophoneIcon} />} title={t("rec.title")} description={t("rec.desc")} />
            <Card.Content>
              <Layout.Stack gap="sm">
                {rec ? (
                  <Layout.Stack gap="sm">
                    <Layout.Row gap="sm">
                      <Badge text={t("rec.recording", { time: formatDuration(elapsed) })} color="red" isDot size="medium" />
                    </Layout.Row>
                    <Button className="w-full" color="danger" onClick={() => void stop()} prefix={<Icon icon={StopIcon} />}>
                      {t("rec.stop")}
                    </Button>
                    <Button className="w-full" variant="tertiary" onClick={cancel}>
                      {t("rec.cancel")}
                    </Button>
                  </Layout.Stack>
                ) : (
                  <Layout.Stack gap="sm">
                    <Button className="w-full" size="large" onClick={() => void start()} prefix={<Icon icon={MicrophoneIcon} />}>
                      {t("rec.start")}
                    </Button>
                    {!typing ? (
                      <Button className="w-full" variant="tertiary" onClick={() => setTyping(true)} prefix={<Icon icon={TextAaIcon} />}>
                        {t("rec.type")}
                      </Button>
                    ) : null}
                  </Layout.Stack>
                )}
                {typing && !rec ? (
                  <Layout.Stack gap="sm">
                    <TextArea
                      label={t("rec.typeLabel")}
                      placeholder={t("rec.typePlaceholder")}
                      value={text}
                      rows={4}
                      onChange={(e) => setText(e.target.value)}
                    />
                    <Layout.Row gap="sm" split>
                      <Button variant="tertiary" onClick={() => setTyping(false)}>{t("rec.cancel")}</Button>
                      <Button onClick={sendText} disabled={!text.trim()}>{t("rec.send")}</Button>
                    </Layout.Row>
                  </Layout.Stack>
                ) : null}
                {recError ? <Alert variant="error" size="compact" description={recError} /> : null}
                {savedNote ? <Notice variant="info" size="compact" description={t("rec.saved")} /> : null}
                {!persisted ? <Notice variant="warning" size="compact" description={t("rec.notPersisted")} /> : null}
              </Layout.Stack>
            </Card.Content>
          </Card>

          <BuddyVoice source={source} online={online} lang={lang} />

          <QueueList
            items={items}
            online={online}
            pending={pending}
            syncing={syncing}
            lang={lang}
            onSync={() => void flush()}
            onRetry={(k) => {
              setItems(retryItem(itemsRef.current, k));
              void flush();
            }}
            onRemove={(k) => setItems(removeItem(itemsRef.current, k))}
            onView={(id) => wait(id)}
          />
        </Layout.Stack>
      </Page.Section>
    </Page>
  );
}
