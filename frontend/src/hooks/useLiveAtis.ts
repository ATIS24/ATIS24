import { useEffect, useRef, useState } from "react";
import { fetchAtisList, streamUrl } from "../lib/api";
import type { AtisData } from "../lib/types";

export type ConnectionMode = "connecting" | "live" | "polling" | "offline";

interface LiveAtisState {
  atisList: AtisData[];
  generatedAt: number | null;
  mode: ConnectionMode;
  error: string | null;
}

type AtisDelta =
  | { type: "add"; airport: string; atis: AtisData }
  | { type: "update"; airport: string; atis: AtisData }
  | { type: "remove"; airport: string };

const POLL_INTERVAL_MS = 12_000;
const SSE_RECONNECT_BASE_MS = 1_500;
const SSE_RECONNECT_MAX_MS = 15_000;
const MAX_SSE_FAILURES_BEFORE_POLLING_FALLBACK = 4;

/**
 * Provides a live-updating list of AtisData, sourced entirely from the
 * realtime-server's authenticated /api/atis + /api/stream endpoints,
 * which themselves are fed by ONE persistent server-side connection to
 * wss://24data.ptfs.app/wss (see realtime-server/src/atis/wsClient.ts).
 * The browser never connects to 24data directly.
 *
 * The SSE stream here is genuinely long-lived (the backing server is a
 * persistent process, not a serverless function with a runtime cap), so
 * this hook applies incremental "delta" events (add/update/remove) on
 * top of an initial "snapshot", rather than re-fetching the whole list
 * on every change. Falls back to REST polling if SSE can't establish at
 * all (proxy/browser restrictions), same resilience shape as before.
 *
 * `enabled` gates the connection on having a valid authenticated
 * session — there's no point opening a stream that will just 401/close
 * repeatedly before login.
 */
export function useLiveAtis(enabled: boolean): LiveAtisState {
  const [atisList, setAtisList] = useState<AtisData[]>([]);
  const [generatedAt, setGeneratedAt] = useState<number | null>(null);
  const [mode, setMode] = useState<ConnectionMode>("connecting");
  const [error, setError] = useState<string | null>(null);

  const sseFailureCount = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const unmountedRef = useRef(false);
  const atisMapRef = useRef<Map<string, AtisData>>(new Map());

  useEffect(() => {
    if (!enabled) {
      setAtisList([]);
      setMode("connecting");
      return;
    }

    unmountedRef.current = false;

    function applySnapshot(list: AtisData[], gen: number) {
      atisMapRef.current = new Map(list.map((a) => [a.airport, a]));
      setAtisList(list);
      setGeneratedAt(gen);
    }

    function applyDelta(delta: AtisDelta) {
      if (delta.type === "remove") {
        atisMapRef.current.delete(delta.airport);
      } else {
        atisMapRef.current.set(delta.airport, delta.atis);
      }
      setAtisList(Array.from(atisMapRef.current.values()).sort((a, b) => a.airport.localeCompare(b.airport)));
      setGeneratedAt(Date.now());
    }

    function startPolling() {
      setMode("polling");
      const poll = async () => {
        try {
          const data = await fetchAtisList();
          if (unmountedRef.current) return;
          applySnapshot(data.atis, data.generatedAt);
          setError(null);
        } catch (err) {
          if (unmountedRef.current) return;
          setError(err instanceof Error ? err.message : "Failed to load ATIS data");
        }
      };
      poll();
      pollTimer.current = setInterval(poll, POLL_INTERVAL_MS);
    }

    function connectSse(attempt: number) {
      if (unmountedRef.current) return;

      const es = new EventSource(streamUrl(), { withCredentials: true });
      eventSourceRef.current = es;

      const scheduleReconnect = () => {
        es.close();
        eventSourceRef.current = null;
        sseFailureCount.current += 1;

        if (sseFailureCount.current >= MAX_SSE_FAILURES_BEFORE_POLLING_FALLBACK) {
          startPolling();
          return;
        }

        setMode("connecting");
        const delay = Math.min(SSE_RECONNECT_BASE_MS * 2 ** attempt, SSE_RECONNECT_MAX_MS);
        reconnectTimer.current = setTimeout(() => connectSse(attempt + 1), delay);
      };

      es.addEventListener("snapshot", (evt) => {
        try {
          const payload = JSON.parse((evt as MessageEvent).data) as {
            atis: AtisData[];
            generatedAt: number;
          };
          applySnapshot(payload.atis, payload.generatedAt);
          sseFailureCount.current = 0;
          setMode("live");
          setError(null);
        } catch {
          // Ignore a single malformed frame; the stream will keep going.
        }
      });

      es.addEventListener("delta", (evt) => {
        try {
          const delta = JSON.parse((evt as MessageEvent).data) as AtisDelta;
          applyDelta(delta);
          setMode("live");
        } catch {
          // Ignore malformed delta frame.
        }
      });

      es.addEventListener("heartbeat", () => {
        setMode("live");
      });

      es.onerror = () => {
        scheduleReconnect();
      };
    }

    connectSse(0);

    return () => {
      unmountedRef.current = true;
      eventSourceRef.current?.close();
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (pollTimer.current) clearInterval(pollTimer.current);
    };
  }, [enabled]);

  return { atisList, generatedAt, mode, error };
}
