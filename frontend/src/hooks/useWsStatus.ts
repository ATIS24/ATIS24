import { useEffect, useRef, useState } from "react";
import { fetchStatus, type StatusResponse } from "../lib/api";

const POLL_INTERVAL_MS = 5_000;

/**
 * Polls GET /api/status — which reports the REAL state of the backend's
 * persistent connection to wss://24data.ptfs.app/wss (see
 * realtime-server/src/atis/wsClient.ts), not merely "is the page loaded"
 * or "is our own SSE connected". This is what the spec means by the
 * status indicator representing the actual upstream realtime connection.
 */
export function useWsStatus(enabled: boolean): StatusResponse["wsStatus"] | "unknown" {
  const [status, setStatus] = useState<StatusResponse["wsStatus"] | "unknown">("unknown");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    const poll = async () => {
      try {
        const data = await fetchStatus();
        if (!cancelled) setStatus(data.wsStatus);
      } catch {
        if (!cancelled) setStatus("unknown");
      }
    };

    poll();
    timerRef.current = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [enabled]);

  return status;
}
