/**
 * ATIS domain types — mirrors backend/lib/types.ts from the original
 * Vercel backend so the frontend contract (AtisData shape) stays
 * identical regardless of which backend serves it.
 *
 * Source of truth for the shape: GET https://24data.ptfs.app/atis and
 * the "ATIS" event on wss://24data.ptfs.app/wss (see wsClient.ts).
 */

import { z } from "zod";

export const RawAtisRecordSchema = z.object({
  airport: z.string().min(1),
  letter: z.string().min(1),
  content: z.string(),
  lines: z.array(z.string()).optional(),
  editor: z.string().nullable().optional(),
});

export type RawAtisRecord = z.infer<typeof RawAtisRecordSchema>;
export const RawAtisResponseSchema = z.array(RawAtisRecordSchema);

/** Envelope for a message on wss://24data.ptfs.app/wss: { t, d, s }. We
 * only care about "t" === "ATIS" for this app; other event types
 * (CONTROLLERS, ACFT_DATA, FLIGHT_PLAN, ...) are ignored. */
export const WsEnvelopeSchema = z.object({
  t: z.string(),
  d: z.unknown(),
  s: z.string().optional(),
});

export interface AtisData {
  airport: string;
  letter: string;
  content: string;
  lines: string[];
  editor: string | null;
  fetchedAt: number;
}

export function normalizeAtisRecord(raw: RawAtisRecord, now: number): AtisData {
  const airport = raw.airport.trim().toUpperCase();
  const content = raw.content ?? "";
  const lines =
    raw.lines && raw.lines.length > 0
      ? raw.lines
      : content
          .split(/\r?\n/)
          .map((l) => l.trim())
          .filter(Boolean);
  return {
    airport,
    letter: raw.letter.trim().toUpperCase(),
    content,
    lines,
    editor: raw.editor ?? null,
    fetchedAt: now,
  };
}

export type WsStatus = "connecting" | "online" | "reconnecting" | "offline";
