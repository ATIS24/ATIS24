import { useEffect, useRef, useState } from "react";
import { fetchLocations, streamUrl } from "../lib/api";
import type { AirportLocation } from "../lib/types";

export type ConnectionMode = "connecting" | "live" | "polling" | "offline";

interface LiveLocationsState {
  locations: AirportLocation[];
  generatedAt: number | null;
  mode: ConnectionMode;
  error: string | null;
}

const POLL_INTERVAL_MS = 15_000;
const SSE_RECONNECT_BASE_MS = 1_500;
const SSE_RECONNECT_MAX_MS = 15_000;
// If SSE keeps failing to even connect within this many attempts, stop
// trying it for the rest of the session and settle on polling — this
// keeps the app fully usable even in environments that block EventSource
// or streaming responses (some corporate proxies, certain browsers).
const MAX_SSE_FAILURES_BEFORE_POLLING_FALLBACK = 4;

/**
 * Provides a live-updating list of AirportLocations.
 *
 * Strategy:
 *  1. Try Server-Sent Events first (near-real-time, low overhead).
 *  2. If the SSE connection errors or closes, reconnect with exponential
 *     backoff (this also transparently covers the backend's own
 *     ~25s-per-invocation stream lifetime — see backend api/stream.ts).
 *  3. If SSE repeatedly fails to establish at all, fall back to plain
 *     polling on a fixed interval so the app keeps working regardless.
 */
export function useLiveLocations(): LiveLocationsState {
  const [locations, setLocations] = useState<AirportLocation[]>([]);
  const [generatedAt, setGeneratedAt] = useState<number | null>(null);
  const [mode, setMode] = useState<ConnectionMode>("connecting");
  const [error, setError] = useState<string | null>(null);

  const sseFailureCount = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const unmountedRef = useRef(false);

  useEffect(() => {
    unmountedRef.current = false;

    function startPolling() {
      setMode("polling");
      const poll = async () => {
        try {
          const data = await fetchLocations();
          if (unmountedRef.current) return;
          setLocations(data.locations);
          setGeneratedAt(data.generatedAt);
          setError(null);
        } catch (err) {
          if (unmountedRef.current) return;
          setError(err instanceof Error ? err.message : "Failed to load locations");
        }
      };
      poll();
      pollTimer.current = setInterval(poll, POLL_INTERVAL_MS);
    }

    function connectSse(attempt: number) {
      if (unmountedRef.current) return;

      const es = new EventSource(streamUrl());
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
        const delay = Math.min(
          SSE_RECONNECT_BASE_MS * 2 ** attempt,
          SSE_RECONNECT_MAX_MS,
        );
        reconnectTimer.current = setTimeout(() => connectSse(attempt + 1), delay);
      };

      es.addEventListener("connected", () => {
        sseFailureCount.current = 0;
      });

      es.addEventListener("snapshot", (evt) => {
        try {
          const payload = JSON.parse((evt as MessageEvent).data) as {
            locations: AirportLocation[];
            generatedAt: number;
          };
          setLocations(payload.locations);
          setGeneratedAt(payload.generatedAt);
          setMode("live");
          setError(null);
        } catch {
          // Ignore a single malformed frame; the stream will keep going.
        }
      });

      es.addEventListener("heartbeat", () => {
        setMode("live");
      });

      es.addEventListener("closing", () => {
        // Backend intentionally ended this invocation's stream lifetime —
        // reconnect immediately, this is expected, not an error.
        scheduleReconnect();
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
  }, []);

  return { locations, generatedAt, mode, error };
}
