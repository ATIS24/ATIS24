/**
 * REST client for https://24data.ptfs.app/atis — used for:
 *  - initial cache population at server startup
 *  - full resynchronization after a WebSocket reconnect (in case any
 *    ATIS events were missed while disconnected)
 *
 * Live updates during normal operation come from the WebSocket
 * (wsClient.ts) — this module is deliberately not polled on an interval.
 */

import { RawAtisResponseSchema, normalizeAtisRecord, type AtisData } from "./types.js";

const BASE_URL = "https://24data.ptfs.app";

export class UpstreamFetchError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "UpstreamFetchError";
  }
}

export async function fetchAtisSnapshot(timeoutMs = 10_000): Promise<AtisData[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${BASE_URL}/atis`, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "atis-radio-realtime-server/1.0",
      },
    });
    if (!res.ok) {
      throw new UpstreamFetchError(`GET /atis responded with ${res.status}`, res.status);
    }
    const json = await res.json();
    const parsed = RawAtisResponseSchema.safeParse(json);
    if (!parsed.success) {
      throw new UpstreamFetchError(`Unexpected /atis shape: ${parsed.error.message}`);
    }
    const now = Date.now();
    return parsed.data.map((record) => normalizeAtisRecord(record, now));
  } finally {
    clearTimeout(timeout);
  }
}
