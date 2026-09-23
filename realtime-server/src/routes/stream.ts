import { Router } from "express";
import { atisStore, type AtisDelta } from "../atis/store";
import { requireGuildMembership } from "../auth/middleware";

export const streamRouter = Router();

const HEARTBEAT_INTERVAL_MS = 15_000;

/**
 * GET /api/stream — Server-Sent Events, authenticated.
 *
 * Unlike the Vercel version of this endpoint (which had to stream in
 * short-lived bursts because a serverless function invocation can't run
 * forever), this is a normal long-lived Express route on a persistent
 * process — the connection can genuinely stay open indefinitely. Sends:
 *   - "snapshot": full current ATIS list, once, right after connecting
 *   - "delta": individual add/update/remove events as they happen,
 *     pushed straight from the WebSocket-fed atisStore
 *   - "status": wsStatus changes (online/reconnecting/offline)
 *   - "heartbeat": periodic keep-alive so intermediary proxies don't
 *     time out the connection
 */
streamRouter.get("/stream", requireGuildMembership, (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  send("snapshot", { atis: atisStore.list(), generatedAt: Date.now() });
  send("status", { wsStatus: atisStore.wsStatus });

  const unsubscribeAtis = atisStore.subscribe((delta: AtisDelta) => {
    send("delta", delta);
  });

  let lastStatus = atisStore.wsStatus;
  const statusInterval = setInterval(() => {
    if (atisStore.wsStatus !== lastStatus) {
      lastStatus = atisStore.wsStatus;
      send("status", { wsStatus: lastStatus });
    }
  }, 1_000);

  const heartbeat = setInterval(() => {
    send("heartbeat", { at: Date.now() });
  }, HEARTBEAT_INTERVAL_MS);

  req.on("close", () => {
    unsubscribeAtis();
    clearInterval(statusInterval);
    clearInterval(heartbeat);
  });
});
