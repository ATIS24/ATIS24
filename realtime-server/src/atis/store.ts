/**
 * In-memory ATIS cache for the persistent realtime server.
 *
 * Unlike the Vercel backend's cache.ts (which needs KV because
 * serverless instances don't share memory), this process is a single
 * long-lived Node process, so a plain Map is a legitimate source of
 * truth here — no external store required.
 *
 * Responsibilities:
 *  - hold the current AtisData for every known airport
 *  - detect version changes (airport + letter + content) per spec
 *  - notify subscribers (SSE connections) of add/update/remove deltas
 *  - track upstream WebSocket status for the /api/status endpoint
 */

import type { AtisData, WsStatus } from "./types";

export type AtisDelta =
  | { type: "add"; airport: string; atis: AtisData }
  | { type: "update"; airport: string; atis: AtisData }
  | { type: "remove"; airport: string };

type Listener = (delta: AtisDelta) => void;

class AtisStore {
  private byAirport = new Map<string, AtisData>();
  private listeners = new Set<Listener>();
  private _wsStatus: WsStatus = "connecting";
  private _lastWsMessageAt: number | null = null;
  private _lastRestSyncAt: number | null = null;

  get wsStatus(): WsStatus {
    return this._wsStatus;
  }

  setWsStatus(status: WsStatus): void {
    this._wsStatus = status;
  }

  get lastWsMessageAt(): number | null {
    return this._lastWsMessageAt;
  }

  get lastRestSyncAt(): number | null {
    return this._lastRestSyncAt;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(delta: AtisDelta) {
    for (const listener of this.listeners) listener(delta);
  }

  list(): AtisData[] {
    return Array.from(this.byAirport.values()).sort((a, b) => a.airport.localeCompare(b.airport));
  }

  get(airport: string): AtisData | null {
    return this.byAirport.get(airport.toUpperCase()) ?? null;
  }

  private version(atis: Pick<AtisData, "letter" | "content">): string {
    return `${atis.letter}::${atis.content}`;
  }

  /** Applies a single updated/created ATIS record (from the WS "ATIS"
   * event, or from a REST resync). Emits "add" for a brand-new airport,
   * "update" only when letter/content actually changed (per spec —
   * letter alone is not globally unique, so we key by airport and
   * version on letter+content together), and does nothing if the
   * incoming record is identical to what we already have. */
  upsert(atis: AtisData): AtisDelta | null {
    const existing = this.byAirport.get(atis.airport);
    if (!existing) {
      this.byAirport.set(atis.airport, atis);
      const delta: AtisDelta = { type: "add", airport: atis.airport, atis };
      this.emit(delta);
      return delta;
    }
    if (this.version(existing) === this.version(atis)) {
      // Same version — refresh bookkeeping fields only, no delta emitted
      // (this matters: we must NOT reset an airport's broadcast timeline
      // just because a REST resync re-delivered identical content).
      this.byAirport.set(atis.airport, { ...atis, fetchedAt: atis.fetchedAt });
      return null;
    }
    this.byAirport.set(atis.airport, atis);
    const delta: AtisDelta = { type: "update", airport: atis.airport, atis };
    this.emit(delta);
    return delta;
  }

  remove(airport: string): AtisDelta | null {
    if (!this.byAirport.has(airport)) return null;
    this.byAirport.delete(airport);
    const delta: AtisDelta = { type: "remove", airport };
    this.emit(delta);
    return delta;
  }

  /** Full resync from GET /atis (startup, or after WS reconnect). Adds
   * new airports, updates changed ones, and removes airports no longer
   * present — mirroring exactly what the live WS feed would eventually
   * converge to, so a client reconnecting via REST-only fallback sees
   * consistent state. */
  resync(records: AtisData[]): AtisDelta[] {
    const deltas: AtisDelta[] = [];
    const seen = new Set<string>();
    for (const record of records) {
      seen.add(record.airport);
      const delta = this.upsert(record);
      if (delta) deltas.push(delta);
    }
    for (const airport of Array.from(this.byAirport.keys())) {
      if (!seen.has(airport)) {
        const delta = this.remove(airport);
        if (delta) deltas.push(delta);
      }
    }
    this._lastRestSyncAt = Date.now();
    return deltas;
  }

  markWsMessage(): void {
    this._lastWsMessageAt = Date.now();
  }
}

export const atisStore = new AtisStore();
