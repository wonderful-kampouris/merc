import { Badge, Button, Card, Layout, Text } from "@wonderful/ui-base";
import messages from "./i18n";
import { useScreenI18n } from "../../../lib/i18n";
import type { QueueItem, QueueStatus } from "./queue";
import { formatDuration } from "./recorder";

const COLOR: Record<QueueStatus, "neutral" | "blue" | "orange" | "green" | "red"> = {
  queued: "orange",
  uploading: "blue",
  processing: "blue",
  ready: "green",
  failed: "red",
};

export interface QueueListProps {
  items: readonly QueueItem[];
  online: boolean;
  pending: number;
  syncing: boolean;
  lang: "el" | "en";
  onSync: () => void;
  onRetry: (key: string) => void;
  onRemove: (key: string) => void;
  onView: (voiceLogId: string) => void;
}

const time = (iso: string, lang: string) => {
  try {
    return new Date(iso).toLocaleTimeString(lang === "el" ? "el-GR" : "en-GB", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso.slice(11, 16);
  }
};

/** The offline queue and recent recordings, newest first. */
export default function QueueList(p: QueueListProps) {
  const { t } = useScreenI18n(messages);
  const items = [...p.items].sort((a, b) => b.recorded_at.localeCompare(a.recorded_at));
  return (
    <Card data-testid="queue">
      <Card.Header
        title={t("queue.title")}
        description={p.pending ? t("queue.pending", { n: p.pending }) : undefined}
        actions={
          <Layout.Row gap="xs">
            {!p.online ? <Badge text={t("queue.offline")} color="orange" size="small" /> : null}
            {p.pending && p.online ? (
              <Button size="small" variant="secondary" loading={p.syncing} onClick={p.onSync}>
                {t("queue.syncNow")}
              </Button>
            ) : null}
          </Layout.Row>
        }
      />
      {items.length === 0 ? (
        <Card.Content>
          <Text variant="body-sm" color="secondary">{t("queue.empty")}</Text>
        </Card.Content>
      ) : (
        <Card.List>
          {items.map((i) => (
            <Card.Meta
              key={i.idempotency_key}
              title={`${time(i.recorded_at, p.lang)} · ${i.audio_mime || (i.duration_ms && !i.transcript) ? t("kind.audio", { time: formatDuration(i.duration_ms ?? 0) }) : t("kind.text")}`}
              description={
                <Layout.Stack gap="xs">
                  <Layout.Row gap="xs" wrap>
                    <Badge text={t(`status.${i.status}`)} color={COLOR[i.status]} size="small" isDot={i.status === "uploading" || i.status === "processing"} />
                    {i.duplicate ? <Badge text={t("queue.duplicate")} variant="outlined" size="small" /> : null}
                  </Layout.Row>
                  {i.transcript ? <Text variant="caption" color="secondary" lineClamp={2}>{i.transcript}</Text> : null}
                  {i.error && i.status === "failed" ? <Text variant="caption" color="danger">{i.error}</Text> : null}
                </Layout.Stack>
              }
              actions={
                i.status === "ready" && i.voice_log_id ? (
                  <Button size="small" variant="tertiary" onClick={() => p.onView(i.voice_log_id!)}>{t("queue.view")}</Button>
                ) : i.status === "failed" ? (
                  <Layout.Row gap="xs">
                    {i.voice_log_id === null ? <Button size="small" variant="secondary" onClick={() => p.onRetry(i.idempotency_key)}>{t("queue.retry")}</Button> : null}
                    <Button size="small" variant="tertiary" onClick={() => p.onRemove(i.idempotency_key)}>{t("queue.remove")}</Button>
                  </Layout.Row>
                ) : undefined
              }
            />
          ))}
        </Card.List>
      )}
    </Card>
  );
}
