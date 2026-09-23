/**
 * Persistent server-side connection to wss://24data.ptfs.app/wss.
 *
 * This is the piece that genuinely cannot live in a Vercel serverless
 * function — a WebSocket needs a long-running process on the other end,
 * and serverless functions are invoked per-request and torn down between
 * invocations. This module is meant to run inside realtime-server, a
 * normal long-lived Node process (see README for deployment targets:
 * Fly.io, Railway, Render, a plain VPS — anything that keeps a process
 * alive).
 *
 * Behavior:
 *  - connects once at startup, and again on every disconnect
 *  - exponential backoff between reconnect attempts, capped
 *  - reports connection status into atisStore so /api/status reflects
 *    the REAL upstream state, not just "the server process is up"
 *  - on connect (including reconnects), triggers a REST resync so any
 *    ATIS events missed while disconnected are caught up
 *  - only the "ATIS" event type is acted on; other event types
 *    (CONTROLLERS, ACFT_DATA, FLIGHT_PLAN, ...) are received but ignored
 *    — this app's ATIS channel list/content never depends on them
 */

import WebSocket from "ws";
import { WsEnvelopeSchema, RawAtisRecordSchema, normalizeAtisRecord } from "./types";
import { atisStore } from "./store";
import { fetchAtisSnapshot } from "./restClient";

const WS_URL = "wss://24data.ptfs.app/wss";
const BASE_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 30_000;
const HEARTBEAT_TIMEOUT_MS = 45_000; // if no message at all in this window, force a reconnect

let socket: WebSocket | null = null;
let reconnectAttempt = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
let stopped = false;

async function resyncFromRest(reason: string): Promise<void> {
  try {
    const snapshot = await fetchAtisSnapshot();
    const deltas = atisStore.resync(snapshot);
    // eslint-disable-next-line no-console
    console.log(
      `[24data] REST resync (${reason}): ${snapshot.length} airports, ${deltas.length} changed`,
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[24data] REST resync failed (${reason}):`, err);
  }
}

function scheduleHeartbeatCheck() {
  if (heartbeatTimer) clearTimeout(heartbeatTimer);
  heartbeatTimer = setTimeout(() => {
    // eslint-disable-next-line no-console
    console.warn("[24data] No WS messages received recently — forcing reconnect");
    socket?.terminate();
  }, HEARTBEAT_TIMEOUT_MS);
}

function handleMessage(raw: WebSocket.RawData) {
  atisStore.markWsMessage();
  scheduleHeartbeatCheck();

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw.toString());
  } catch {
    return; // malformed frame — ignore, do not crash
  }

  const envelope = WsEnvelopeSchema.safeParse(parsedJson);
  if (!envelope.success) return;

  if (envelope.data.t !== "ATIS") {
    // CONTROLLERS / ACFT_DATA / FLIGHT_PLAN / etc. — irrelevant to the
    // ATIS radio channel list by design (see spec section 8/24).
    return;
  }

  const record = RawAtisRecordSchema.safeParse(envelope.data.d);
  if (!record.success) return;

  const normalized = normalizeAtisRecord(record.data, Date.now());
  atisStore.upsert(normalized);
}

function connect() {
  if (stopped) return;

  atisStore.setWsStatus(reconnectAttempt === 0 ? "connecting" : "reconnecting");
  // eslint-disable-next-line no-console
  console.log(`[24data] Connecting to ${WS_URL} (attempt ${reconnectAttempt + 1})`);

  socket = new WebSocket(WS_URL, {
    headers: { "User-Agent": "atis-radio-realtime-server/1.0" },
  });

  socket.on("open", () => {
    // eslint-disable-next-line no-console
    console.log("[24data] WebSocket connected");
    reconnectAttempt = 0;
    atisStore.setWsStatus("online");
    scheduleHeartbeatCheck();
    // Resync on every (re)connect so any events missed while disconnected
    // are caught up immediately rather than waiting for the next change.
    void resyncFromRest(reconnectAttempt === 0 ? "startup" : "reconnect");
  });

  socket.on("message", handleMessage);

  socket.on("close", () => {
    atisStore.setWsStatus("reconnecting");
    if (heartbeatTimer) clearTimeout(heartbeatTimer);
    scheduleReconnect();
  });

  socket.on("error", (err) => {
    // eslint-disable-next-line no-console
    console.error("[24data] WebSocket error:", err.message);
    // "close" will also fire after "error" in ws; reconnect is scheduled there.
  });
}

function scheduleReconnect() {
  if (stopped) return;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  const delay = Math.min(
    BASE_RECONNECT_DELAY_MS * 2 ** reconnectAttempt,
    MAX_RECONNECT_DELAY_MS,
  );
  reconnectAttempt += 1;
  // eslint-disable-next-line no-console
  console.log(`[24data] Reconnecting in ${delay}ms`);
  reconnectTimer = setTimeout(connect, delay);
}

/** Starts the persistent upstream connection. Call once at process
 * startup. Also performs the initial REST fetch immediately (in
 * parallel with the WS handshake) so the cache is populated even before
 * the socket finishes connecting. */
export function startAtc24RealtimeClient(): void {
  stopped = false;
  void resyncFromRest("startup-rest-preload");
  connect();
}

export function stopAtc24RealtimeClient(): void {
  stopped = true;
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (heartbeatTimer) clearTimeout(heartbeatTimer);
  socket?.close();
  atisStore.setWsStatus("offline");
}
