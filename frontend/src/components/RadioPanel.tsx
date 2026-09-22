import { useEffect, useRef, useState } from "react";
import type { AirportLocation } from "../lib/types";
import type { RadioPowerState } from "../hooks/useRadioAudio";

interface RadioPanelProps {
  location: AirportLocation | null;
  power: RadioPowerState;
  speaking: boolean;
  onTogglePower: () => void;
  onPlay: () => void;
  connectionLabel: string;
  connectionOk: boolean;
}

export function RadioPanel({
  location,
  power,
  speaking,
  onTogglePower,
  onPlay,
  connectionLabel,
  connectionOk,
}: RadioPanelProps) {
  const [flicker, setFlicker] = useState(false);
  const prevAtisContent = useRef<string | null>(null);

  useEffect(() => {
    if (power === "on") {
      setFlicker(true);
      const t = setTimeout(() => setFlicker(false), 260);
      return () => clearTimeout(t);
    }
  }, [power]);

  const isPoweredOn = power === "on" || power === "starting";
  const atisChanged =
    location?.atis?.content !== undefined &&
    prevAtisContent.current !== null &&
    prevAtisContent.current !== location.atis.content;

  useEffect(() => {
    prevAtisContent.current = location?.atis?.content ?? null;
  }, [location?.atis?.content]);

  return (
    <div className={`radio-panel${isPoweredOn ? " radio-panel--on" : ""}${flicker ? " radio-panel--flicker" : ""}`}>
      <div className="radio-panel__top">
        <div className="radio-panel__brand">
          <span className="radio-panel__brand-mark">COM 1</span>
          <span className="radio-panel__brand-sub">ATC24 VIRTUAL ATIS RECEIVER</span>
        </div>
        <ConnectionBadge label={connectionLabel} ok={connectionOk} />
      </div>

      <div className="radio-panel__lcd-well">
        <div className="lcd">
          <div className="lcd__row lcd__row--primary">
            <span className="lcd__label">STA</span>
            <span className="lcd__value">{location ? location.code : "----"}</span>
          </div>
          <div className="lcd__row">
            <span className="lcd__label">FRQ</span>
            <span className="lcd__value lcd__value--freq">
              {location?.frequency ?? "---.---"}
            </span>
          </div>
          <div className="lcd__row">
            <span className="lcd__label">ATIS</span>
            <span
              className={`lcd__value lcd__value--letter${
                location?.atis ? "" : " lcd__value--dim"
              }${atisChanged ? " lcd__value--updated" : ""}`}
            >
              {location?.atis?.letter ?? "—"}
            </span>
            <AtisStatusChip location={location} />
          </div>
        </div>
        {!isPoweredOn && <div className="lcd__glass-off" aria-hidden="true" />}
      </div>

      <div className="radio-panel__controls">
        <button
          type="button"
          className={`power-knob${isPoweredOn ? " power-knob--on" : ""}`}
          onClick={onTogglePower}
          aria-pressed={isPoweredOn}
          aria-label={isPoweredOn ? "Turn radio off" : "Turn radio on"}
        >
          <span className="power-knob__ring" />
          <span className="power-knob__label">{isPoweredOn ? "ON" : "OFF"}</span>
        </button>

        <button
          type="button"
          className="play-button"
          onClick={onPlay}
          disabled={!isPoweredOn || !location?.atis}
        >
          <PlayIcon speaking={speaking} />
          {speaking ? "Receiving…" : "Play ATIS"}
        </button>

        <div className={`squelch-led${speaking ? " squelch-led--active" : ""}`} aria-hidden="true">
          <span className="squelch-led__dot" />
          <span className="squelch-led__text">SQL</span>
        </div>
      </div>

      {location?.atis && (
        <div className="radio-panel__transcript" aria-live="polite">
          <p className="radio-panel__transcript-label">Transcript</p>
          <p className="radio-panel__transcript-text">{location.atis.content}</p>
        </div>
      )}

      {location && !location.atis && (
        <p className="radio-panel__empty-note">
          {location.hasController
            ? "This station is staffed, but no ATIS broadcast is currently active."
            : "No controller is currently online for this station."}
        </p>
      )}

      {!location && (
        <p className="radio-panel__empty-note">Select an airport from the list to tune this radio.</p>
      )}
    </div>
  );
}

function ConnectionBadge({ label, ok }: { label: string; ok: boolean }) {
  return (
    <span className={`connection-badge${ok ? "" : " connection-badge--warn"}`}>
      <span className="connection-badge__dot" />
      {label}
    </span>
  );
}

function AtisStatusChip({ location }: { location: AirportLocation | null }) {
  if (!location) return null;
  if (location.atisStatus === "available") {
    return <span className="atis-chip atis-chip--available">AVAILABLE</span>;
  }
  if (location.atisStatus === "stale") {
    return <span className="atis-chip atis-chip--stale">STALE</span>;
  }
  return <span className="atis-chip atis-chip--unavailable">UNAVAILABLE</span>;
}

function PlayIcon({ speaking }: { speaking: boolean }) {
  if (speaking) {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
        <rect x="2" y="2" width="3.2" height="10" fill="currentColor" />
        <rect x="8.8" y="2" width="3.2" height="10" fill="currentColor" />
      </svg>
    );
  }
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="M3 2L12 7L3 12V2Z" fill="currentColor" />
    </svg>
  );
}
