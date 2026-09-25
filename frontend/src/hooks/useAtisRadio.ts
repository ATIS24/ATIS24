import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useLiveAtis, type ConnectionMode } from "./useLiveAtis";
import { BroadcastEngine, type StationState } from "../lib/broadcastEngine";
import { RadioAudioEngine } from "../lib/radioAudio";
import { normalizeAtisForSpeech, phoneticLetter } from "../lib/phonetics";
import { frequencyForAirport } from "../lib/frequency";
import type { AtisData } from "../lib/types";

export type RadioPowerState = "off" | "starting" | "on";

export interface ChannelInfo {
  airport: string | null;
  frequency: string | null;
  atis: AtisData | null;
}

interface UseAtisRadioResult {
  /** Every airport currently present in /atis, in stable sorted order. */
  availableAirports: string[];
  active: ChannelInfo;
  standby: ChannelInfo;
  activeStationState: StationState | null;
  power: RadioPowerState;
  receiving: boolean; // audio actually audible right now (speaking or gap-static) for ACTIVE
  tuneNext: () => void;
  tunePrev: () => void;
  togglePower: () => void;
  connectionMode: ConnectionMode;
  connectionOk: boolean;
  lastUpdatedAt: number | null;
  loadError: string | null;
}

const STATE_POLL_INTERVAL_MS = 200;

/**
 * The radio's central orchestration hook. Owns:
 *  - the live /atis list (via useLiveAtis)
 *  - the independent-per-airport BroadcastEngine simulation clock
 *  - ACTIVE/STANDBY channel selection + wraparound navigation
 *  - wiring the RadioAudioEngine so that:
 *      - tuning ACTIVE to a station plays whatever that station's
 *        broadcast is CURRENTLY doing (mid-message or in-gap), never
 *        restarting it
 *      - tuning away leaves that station's simulated timeline running
 *        untouched
 *      - an ATIS version change on ANY station (including the currently
 *        ACTIVE one) immediately interrupts whatever audio is playing
 *        for it and restarts that station's cycle from zero
 */
export function useAtisRadio(enabled: boolean): UseAtisRadioResult {
  const { atisList, generatedAt, mode, error } = useLiveAtis(enabled);

  const engineRef = useRef<BroadcastEngine>(new BroadcastEngine());
  const audioRef = useRef<RadioAudioEngine | null>(null);
  if (!audioRef.current) {
    audioRef.current = new RadioAudioEngine();
  }

  const [power, setPower] = useState<RadioPowerState>("off");
  const [activeAirport, setActiveAirport] = useState<string | null>(null);
  const [tick, setTick] = useState(0); // forces periodic re-render to reflect engine clock
  const [receiving, setReceiving] = useState(false);

  // Tracks which (airport, atisVersion, phase) combination audio is
  // currently rendering for, so we know when to start/interrupt/replace
  // playback rather than re-triggering speech every polling tick.
  const audioSessionRef = useRef<{
    airport: string | null;
    atisVersion: string | null;
    phase: "speaking" | "gap" | null;
  }>({ airport: null, atisVersion: null, phase: null });

  const availableAirports = useMemo(
    () => Array.from(new Set(atisList.map((a) => a.airport))).sort(),
    [atisList],
  );

  // Sync the broadcast engine with the latest /atis snapshot every time
  // it changes. This is what implements "ATIS content change interrupts
  // immediately, regardless of which station is ACTIVE" — sync() resets
  // only the stations whose version actually changed.
  useEffect(() => {
    engineRef.current.sync(atisList, Date.now());
  }, [atisList]);

  // Keep ACTIVE valid: preserve current selection if it still exists;
  // otherwise fall back to the first available airport; never reset
  // selection just because of a routine data refresh (spec section 5).
  useEffect(() => {
    if (activeAirport && availableAirports.includes(activeAirport)) return;
    setActiveAirport(availableAirports.length > 0 ? availableAirports[0] : null);
  }, [availableAirports, activeAirport]);

  // Simulation clock: re-render frequently enough for the UI/audio layer
  // to react to phase transitions (speaking <-> gap) promptly, without
  // being wasteful.
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), STATE_POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  const activeStationState = useMemo(() => {
    if (!activeAirport) return null;
    return engineRef.current.getStationState(activeAirport, Date.now());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAirport, tick, atisList]);

  const standbyAirport = useMemo(() => {
    if (availableAirports.length === 0) return null;
    if (availableAirports.length === 1) return null; // spec: STANDBY = "----" when only one airport
    if (!activeAirport) return availableAirports[0];
    const idx = availableAirports.indexOf(activeAirport);
    const nextIdx = (idx + 1) % availableAirports.length;
    return availableAirports[nextIdx];
  }, [availableAirports, activeAirport]);

  const findAtis = useCallback(
    (airport: string | null): AtisData | null => {
      if (!airport) return null;
      return atisList.find((a) => a.airport === airport) ?? null;
    },
    [atisList],
  );

  // --- Audio orchestration ---------------------------------------------
  //
  // Runs on every simulation tick. Decides whether the audio engine needs
  // to (a) do nothing (already correctly rendering this station/version/
  // phase), (b) start speaking the current station's current message from
  // its current position estimate, (c) switch to silence/light static
  // because the station is in its gap, or (d) immediately interrupt
  // because the ACTIVE station's atisVersion changed underneath it.
  useEffect(() => {
    const audio = audioRef.current!;
    if (power !== "on" || !activeAirport || !activeStationState) {
      if (audioSessionRef.current.airport !== null) {
        audio.stop();
        audioSessionRef.current = { airport: null, atisVersion: null, phase: null };
        setReceiving(false);
      }
      return;
    }

    const session = audioSessionRef.current;
    const sameStation = session.airport === activeAirport;
    const sameVersion = session.atisVersion === activeStationState.atisVersion;
    const samePhase = session.phase === activeStationState.phase;

    if (sameStation && sameVersion && samePhase) {
      // Nothing changed since the last tick that requires touching audio.
      return;
    }

    // Any of: different station tuned in, ATIS version changed (must
    // interrupt immediately per spec section 17-19), or phase transitioned
    // (speaking -> gap or gap -> speaking).
    audio.stop();

    if (activeStationState.phase === "gap") {
      // Light static during the inter-message gap — not silence, not a
      // restart of speech.
      audio.setIdleStaticLevel(0.045);
      audioSessionRef.current = {
        airport: activeAirport,
        atisVersion: activeStationState.atisVersion,
        phase: "gap",
      };
      setReceiving(true);
      return;
    }

    // phase === "speaking": tune into the CURRENT position of this
    // station's message rather than restarting from the top. Browser
    // SpeechSynthesis has no reliable seek API, so we approximate by
    // speaking only the remaining portion of the normalized text,
    // estimated proportionally from phaseProgress against word count —
    // this satisfies the user-visible requirement ("hear the current
    // part, not the beginning") even though the underlying mechanism is
    // an approximation rather than a true seek, exactly as anticipated
    // in the spec's "speech timeline consideration" section.
    const atis = activeStationState.atis;
    const letterSpoken = phoneticLetter(atis.letter);
    const fullSpeechText = `${atis.airport} ATIS, information ${letterSpoken}. ${normalizeAtisForSpeech(
      atis.content,
    )}`;
    const words = fullSpeechText.split(/\s+/).filter(Boolean);
    const startWordIndex = Math.min(
      words.length - 1,
      Math.floor(words.length * activeStationState.phaseProgress),
    );
    const remainingText = words.slice(startWordIndex).join(" ") || fullSpeechText;

    audioSessionRef.current = {
      airport: activeAirport,
      atisVersion: activeStationState.atisVersion,
      phase: "speaking",
    };
    setReceiving(true);

    audio.speak(remainingText).then(({ cancelled }) => {
      // Only clear receiving state if this promise resolution still
      // corresponds to the session that's current when it finishes —
      // otherwise a stale resolution from an interrupted utterance could
      // stomp on a newer session's state.
      if (!cancelled) {
        setReceiving(false);
      }
    });
  }, [power, activeAirport, activeStationState]);

  // Stop audio entirely on unmount.
  useEffect(() => {
    return () => {
      audioRef.current?.destroy();
    };
  }, []);

  const tuneNext = useCallback(() => {
    if (availableAirports.length === 0) return;
    audioRef.current?.playTuneStatic();
    setActiveAirport((current) => {
      if (!current) return availableAirports[0];
      const idx = availableAirports.indexOf(current);
      const nextIdx = (idx + 1) % availableAirports.length;
      return availableAirports[nextIdx];
    });
  }, [availableAirports]);

  const tunePrev = useCallback(() => {
    if (availableAirports.length === 0) return;
    audioRef.current?.playTuneStatic();
    setActiveAirport((current) => {
      if (!current) return availableAirports[0];
      const idx = availableAirports.indexOf(current);
      const prevIdx = (idx - 1 + availableAirports.length) % availableAirports.length;
      return availableAirports[prevIdx];
    });
  }, [availableAirports]);

  const togglePower = useCallback(() => {
    if (power === "off") {
      setPower("starting");
      audioRef.current?.unlock().then(
        () => setPower("on"),
        () => setPower("off"),
      );
    } else {
      audioRef.current?.stop();
      audioSessionRef.current = { airport: null, atisVersion: null, phase: null };
      setReceiving(false);
      setPower("off");
    }
  }, [power]);

  const active: ChannelInfo = useMemo(
    () => ({
      airport: activeAirport,
      frequency: activeAirport ? frequencyForAirport(activeAirport) : null,
      atis: findAtis(activeAirport),
    }),
    [activeAirport, findAtis],
  );

  const standby: ChannelInfo = useMemo(
    () => ({
      airport: standbyAirport,
      frequency: standbyAirport ? frequencyForAirport(standbyAirport) : null,
      atis: findAtis(standbyAirport),
    }),
    [standbyAirport, findAtis],
  );

  return {
    availableAirports,
    active,
    standby,
    activeStationState,
    power,
    receiving,
    tuneNext,
    tunePrev,
    togglePower,
    connectionMode: mode,
    connectionOk: mode === "live" || mode === "polling",
    lastUpdatedAt: generatedAt,
    loadError: error,
  };
}
