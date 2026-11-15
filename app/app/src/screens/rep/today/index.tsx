import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ScreenProps } from "../../../lib/screenRegistry";
import { useLive } from "../../../lib/useLive";
import { setCustomerFocus } from "../customers/customerFocus";
import { loadToday, TodayUnavailableError } from "./loadToday";
import { createLocalTodayCache } from "./planCache";
import TodayView, { type TodayViewState } from "./TodayView";

/** Today refreshes itself this often even while the socket is open, so a logged meeting shows up within seconds. */
const REFRESH_MS = 8_000;

const isOnline = (): boolean => (typeof navigator === "undefined" ? true : navigator.onLine !== false);

/** Rep "Today": today's stops in route order, briefing and week progress; works offline from the device cache (REQ-BRF-004). */
export default function Today({ screen, client, openLiveSocket, navigate, lang }: ScreenProps) {
  const cache = useMemo(() => createLocalTodayCache(), []);
  const [state, setState] = useState<TodayViewState>({ status: "loading" });
  const [completing, setCompleting] = useState<ReadonlySet<string>>(new Set());
  const lastFetch = useRef(0);
  const seq = useRef(0);

  const refetch = useCallback(async (quiet = false) => {
    const mine = ++seq.current;
    lastFetch.current = Date.now();
    if (!quiet) setState((s) => (s.status === "ready" ? { ...s, refreshing: true } : { status: "loading" }));
    try {
      const load = await loadToday(client, { cache, online: isOnline(), now: new Date() });
      if (mine === seq.current) setState({ status: "ready", load, refreshing: false });
    } catch (e) {
      if (mine !== seq.current) return;
      setState({ status: "error", reason: e instanceof TodayUnavailableError ? e.reason : "upstream_failed" });
    }
  }, [client, cache]);

  useEffect(() => {
    void refetch();
    const onNet = () => void refetch();
    globalThis.addEventListener?.("online", onNet);
    globalThis.addEventListener?.("offline", onNet);
    const timer = setInterval(() => {
      if (Date.now() - lastFetch.current >= REFRESH_MS - 500 && !document.hidden) void refetch(true);
    }, REFRESH_MS);
    return () => {
      clearInterval(timer);
      globalThis.removeEventListener?.("online", onNet);
      globalThis.removeEventListener?.("offline", onNet);
    };
  }, [refetch]);

  const live = useLive({
    types: screen.events,
    openSocket: openLiveSocket,
    poll: () => {
      if (Date.now() - lastFetch.current >= REFRESH_MS) void refetch(true);
    },
    onEvent: (e) => {
      void refetch(true);
    },
  });

  return (
    <TodayView
      state={state}
      lang={lang}
      mock={client.mock}
      offlineCapable={screen.offline}
      live={live}
      now={new Date()}
      onRetry={() => void refetch()}
      onOpenAccount={(id) => {
        setCustomerFocus(id);
        navigate("/rep/customers");
      }}
      onRecord={() => navigate("/rep/record")}
      onOpenWeek={() => navigate("/rep/week")}
      completing={completing}
      onCompleteTask={(taskId) => {
        setCompleting((s) => new Set(s).add(taskId));
        client
          .call("task-update", { task_id: taskId, status: "done" })
          .then(() => refetch(true))
          .catch(() => undefined)
          .finally(() =>
            setCompleting((s) => {
              const n = new Set(s);
              n.delete(taskId);
              return n;
            }),
          );
      }}
    />
  );
}
