import { useEffect, useRef, useState } from "react";
import type { EventType, MercEvent } from "../contracts";
import { subscribeLive, type LiveMode, type SocketLike } from "./live";

/** React wrapper around subscribeLive for a screen's app.json events. */
export function useLive(params: {
  types: readonly string[];
  openSocket?: () => SocketLike;
  poll?: () => unknown;
  onEvent?: (e: MercEvent<EventType>) => void;
}): LiveMode | null {
  const [mode, setMode] = useState<LiveMode | null>(null);
  const ref = useRef(params);
  ref.current = params;
  const key = params.types.join(",");
  const hasSocket = !!params.openSocket;
  useEffect(() => {
    if (!key) return;
    return subscribeLive({
      types: key.split(",") as EventType[],
      openSocket: hasSocket ? () => ref.current.openSocket!() : undefined,
      poll: () => ref.current.poll?.(),
      onEvent: (e) => ref.current.onEvent?.(e),
      onMode: setMode,
    });
  }, [key, hasSocket]);
  return key ? mode : null;
}
