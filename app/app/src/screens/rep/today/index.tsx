import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ScreenProps } from "../../../lib/screenRegistry";
import { useLive } from "../../../lib/useLive";
import { setCustomerFocus } from "../customers/customerFocus";
import { loadToday, TodayUnavailableError } from "./loadToday";
import { createLocalTodayCache } from "./planCache";
import TodayView, { type TodayViewState } from "./TodayView";

/** Live polling refetches at most this often (the socket pushes briefing.ready / plan.proposed). */
const MIN_REFETCH_MS = 60_000;

const isOnline = (): boolean => (typeof navigator === "undefined" ? true : navigator.onLine !== false);

/** Rep "Today": today's stops in route order, briefing and week progress; works offline from the device cache (REQ-BRF-004). */
export default function Today({ screen, client, openLiveSocket, navigate, lang }: ScreenProps) {
  const cache = useMemo(() => createLocalTodayCache(), []);
  const [state, setState] = useState<TodayViewState>({ status: "loading" });
  const lastFetch = useRef(0);
  const seq = useRef(0);

  const refetch = useCallback(async () => {
    const mine = ++seq.current;
    lastFetch.current = Date.now();
    setState((s) => (s.status === "ready" ? { ...s, refreshing: true } : { status: "loading" }));
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
    return () => {
      globalThis.removeEventListener?.("online", onNet);
      globalThis.removeEventListener?.("offline", onNet);
    };
  }, [refetch]);

  const live = useLive({
    types: screen.events,
    openSocket: openLiveSocket,
    poll: () => {
      if (Date.now() - lastFetch.current >= MIN_REFETCH_MS) void refetch();
    },
    onEvent: (e) => {
      if (e.type === "briefing.ready" || e.type === "plan.proposed") void refetch();
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
    />
  );
}
