/**
 * BroadcastEngine — simulates a set of independent, continuously running
 * ATIS "transmitters", one per airport, exactly as a real ATIS frequency
 * works: the broadcast keeps going whether or not anyone is tuned in.
 *
 * Model (see spec section 14):
 *
 *   currentPosition = (now - broadcastStartedAt) % (messageDuration + gapDuration)
 *
 * Each airport's station has its own:
 *   - broadcastStartedAt   when the CURRENT atisVersion started its cycle
 *   - messageDuration      estimated speech duration for the current ATIS
 *   - gapDuration           fixed 5000ms silence/static after each message
 *   - atisVersion           airport + letter + content fingerprint
 *
 * Tuning behavior (sections 10-19):
 *   - Selecting an airport as ACTIVE does NOT reset or restart its
 *     timeline. The radio simply starts reading whatever phase that
 *     station's own independent cycle is currently in.
 *   - Deselecting (tuning away) does NOT pause that station's timeline —
 *     it keeps advancing in the background, exactly like a real
 *     frequency nobody happens to be listening to.
 *   - If a station's underlying ATIS content changes (new atisVersion)
 *     while it is mid-cycle, that station's timeline is immediately reset
 *     to position 0 of the NEW version — old content is discarded
 *     instantly, never allowed to "finish". This happens whether or not
 *     that station is the one currently ACTIVE.
 *
 * This module has no knowledge of React, audio, or the UI — it's a pure
 * simulation clock keyed by airport code. Callers (useAtisRadio) poll
 * `getStationState(airport)` on an interval and react to phase/version
 * changes.
 */

import type { AtisData } from "./types";

export type BroadcastPhase = "speaking" | "gap";

export interface StationState {
  airport: string;
  atisVersion: string;
  phase: BroadcastPhase;
  /** 0..1 position within the current phase segment (speaking or gap). */
  phaseProgress: number;
  /** 0..1 position within the overall speaking+gap cycle. */
  cycleProgress: number;
  messageDurationMs: number;
  gapDurationMs: number;
  atis: AtisData;
}

interface StationInternal {
  atis: AtisData;
  atisVersion: string;
  broadcastStartedAt: number;
  messageDurationMs: number;
  gapDurationMs: number;
}

const GAP_DURATION_MS = 5_000;

// Speech-rate estimate used purely to size each station's simulated
// timeline (independent of whatever the actual SpeechSynthesis engine
// does when audio is later rendered for the ACTIVE station — see
// useAtisRadio, which re-derives actual spoken duration separately).
// ~155 words/minute is a reasonable brisk-but-clear ATIS reading pace.
const WORDS_PER_MINUTE = 155;
const MIN_MESSAGE_DURATION_MS = 6_000;
const MAX_MESSAGE_DURATION_MS = 45_000;

function estimateMessageDuration(content: string): number {
  const wordCount = content.trim().split(/\s+/).filter(Boolean).length;
  const ms = (wordCount / WORDS_PER_MINUTE) * 60_000;
  return Math.min(MAX_MESSAGE_DURATION_MS, Math.max(MIN_MESSAGE_DURATION_MS, ms));
}

export function computeAtisVersion(airport: string, letter: string, content: string): string {
  return `${airport}::${letter}::${content}`;
}

export class BroadcastEngine {
  private stations = new Map<string, StationInternal>();

  /**
   * Sync the engine's known stations with the latest /atis snapshot.
   * - New airports get a fresh station, timeline starting now.
   * - Airports whose atisVersion is unchanged are left completely alone
   *   (their timeline keeps running from wherever it already was).
   * - Airports whose atisVersion changed get IMMEDIATELY reset: old
   *   content is discarded, new content starts a fresh cycle at position
   *   0, right now. This is what makes the "interrupt immediately on
   *   ATIS update" requirement work uniformly for every station, whether
   *   or not it's the one currently being listened to.
   * - Airports no longer present in the snapshot are removed.
   */
  sync(atisList: AtisData[], now: number): void {
    const seen = new Set<string>();

    for (const atis of atisList) {
      seen.add(atis.airport);
      const version = computeAtisVersion(atis.airport, atis.letter, atis.content);
      const existing = this.stations.get(atis.airport);

      if (!existing || existing.atisVersion !== version) {
        // New station, or existing station's ATIS content/letter changed:
        // start (or restart) its cycle from position 0 right now.
        this.stations.set(atis.airport, {
          atis,
          atisVersion: version,
          broadcastStartedAt: now,
          messageDurationMs: estimateMessageDuration(atis.content),
          gapDurationMs: GAP_DURATION_MS,
        });
      } else {
        // Unchanged content — just refresh the stored AtisData reference
        // (editor/fetchedAt bookkeeping) without touching the timeline.
        existing.atis = atis;
      }
    }

    for (const airport of Array.from(this.stations.keys())) {
      if (!seen.has(airport)) {
        this.stations.delete(airport);
      }
    }
  }

  hasStation(airport: string): boolean {
    return this.stations.has(airport);
  }

  listAirports(): string[] {
    return Array.from(this.stations.keys()).sort();
  }

  /** Computes the given station's current broadcast phase/position at
   * time `now`, without mutating anything — pure read. Returns null if
   * that airport isn't currently a known station. */
  getStationState(airport: string, now: number): StationState | null {
    const station = this.stations.get(airport);
    if (!station) return null;

    const cycleDuration = station.messageDurationMs + station.gapDurationMs;
    const elapsed = Math.max(0, now - station.broadcastStartedAt);
    const cyclePosition = elapsed % cycleDuration;

    const phase: BroadcastPhase = cyclePosition < station.messageDurationMs ? "speaking" : "gap";
    const phaseProgress =
      phase === "speaking"
        ? cyclePosition / station.messageDurationMs
        : (cyclePosition - station.messageDurationMs) / station.gapDurationMs;

    return {
      airport,
      atisVersion: station.atisVersion,
      phase,
      phaseProgress: Math.min(1, Math.max(0, phaseProgress)),
      cycleProgress: cyclePosition / cycleDuration,
      messageDurationMs: station.messageDurationMs,
      gapDurationMs: station.gapDurationMs,
      atis: station.atis,
    };
  }
}
