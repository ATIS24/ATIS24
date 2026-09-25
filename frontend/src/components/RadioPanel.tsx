import { useEffect, useRef, useState } from "react";
import type { ChannelInfo, RadioPowerState } from "../hooks/useAtisRadio";
import type { StationState } from "../lib/broadcastEngine";
import type { StatusResponse } from "../lib/api";

interface RadioPanelProps {
  active: ChannelInfo;
  standby: ChannelInfo;
  activeStationState: StationState | null;
  power: RadioPowerState;
  receiving: boolean;
  onTuneNext: () => void;
  onTunePrev: () => void;
  onTogglePower: () => void;
  wsStatus: StatusResponse["wsStatus"] | "unknown";
  airportCount: number;
  username: string | null;
  onLogout: () => void;
}

export function RadioPanel({
  active,
  standby,
  activeStationState,
  power,
  receiving,
  onTuneNext,
  onTunePrev,
  onTogglePower,
  wsStatus,
  airportCount,
  username,
  onLogout,
}: RadioPanelProps) {
  const isPoweredOn = power === "on" || power === "starting";
  const [flicker, setFlicker] = useState(false);
  const prevAirport = useRef<string | null>(null);

  useEffect(() => {
    if (power === "on") {
      setFlicker(true);
      const t = setTimeout(() => setFlicker(false), 220);
      return () => clearTimeout(t);
    }
  }, [power]);

  useEffect(() => {
    prevAirport.current = active.airport;
  }, [active.airport]);

  const hasNoAirports = airportCount === 0;

  return (
    <div
      className={`radio-panel${isPoweredOn ? " radio-panel--on" : ""}${
        flicker ? " radio-panel--flicker" : ""
      }`}
    >
      <div className="radio-panel__top">
        <div className="radio-panel__brand">
          <span className="radio-panel__brand-mark">COM 1 &nbsp;·&nbsp; ATIS</span>
          <span className="radio-panel__brand-sub">ATC24 VIRTUAL ATIS RECEIVER</span>
        </div>
        <ConnectionBadge status={wsStatus} />
      </div>

      <div className="radio-panel__lcd-well">
        <div className="lcd">
          {hasNoAirports ? (
            <div className="lcd__empty-state">NO ATIS AVAILABLE</div>
          ) : (
            <div className="lcd__channels">
              <ChannelColumn label="ACTIVE" channel={active} emphasis receiving={receiving} />
              <div className="lcd__divider" aria-hidden="true" />
              <ChannelColumn label="STANDBY" channel={standby} emphasis={false} receiving={false} />
            </div>
          )}
          {!hasNoAirports && <PhaseIndicator state={activeStationState} />}
        </div>
        {!isPoweredOn && <div className="lcd__glass-off" aria-hidden="true" />}
      </div>

      <div className="radio-panel__controls">
        <button
          type="button"
          className="side-nav side-nav--left"
          onClick={onTunePrev}
          disabled={!isPoweredOn || airportCount < 2}
          aria-label="Previous ATIS airport"
        >
          &#8249;
        </button>

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

        <div className={`squelch-led${receiving ? " squelch-led--active" : ""}`} aria-hidden="true">
          <span className="squelch-led__dot" />
          <span className="squelch-led__text">RX</span>
        </div>

        <button
          type="button"
          className="side-nav side-nav--right"
          onClick={onTuneNext}
          disabled={!isPoweredOn || airportCount < 2}
          aria-label="Next ATIS airport"
        >
          &#8250;
        </button>
      </div>

      {!isPoweredOn && (
        <p className="radio-panel__empty-note">Press ON to enable radio audio.</p>
      )}

      {isPoweredOn && active.atis && (
        <div className="radio-panel__transcript" aria-live="polite">
          <p className="radio-panel__transcript-label">
            {active.airport} &nbsp;transcript
          </p>
          <p className="radio-panel__transcript-text">{active.atis.content}</p>
        </div>
      )}

      <div className="radio-panel__session-row">
        <span className="radio-panel__session-user">{username ?? ""}</span>
        <button type="button" className="radio-panel__logout" onClick={onLogout}>
          Logout
        </button>
      </div>
    </div>
  );
}

function ChannelColumn({
  label,
  channel,
  emphasis,
  receiving,
}: {
  label: string;
  channel: ChannelInfo;
  emphasis: boolean;
  receiving: boolean;
}) {
  return (
    <div className={`lcd__channel${emphasis ? " lcd__channel--active" : " lcd__channel--standby"}`}>
      <span className="lcd__channel-label">
        {label}
        {receiving && <span className="lcd__rx-dot" aria-hidden="true" />}
      </span>
      <span className="lcd__airport">{channel.airport ?? "----"}</span>
      <span className="lcd__freq">{channel.frequency ?? "---.---"}</span>
      <span className={`lcd__atis-line${channel.atis ? "" : " lcd__atis-line--dim"}`}>
        {channel.atis ? `ATIS INFO ${channel.atis.letter}` : "NO ATIS"}
      </span>
    </div>
  );
}

function PhaseIndicator({ state }: { state: StationState | null }) {
  if (!state) return null;
  return (
    <div className={`phase-indicator phase-indicator--${state.phase}`}>
      <span className="phase-indicator__dot" aria-hidden="true" />
      {state.phase === "speaking" ? "TRANSMITTING" : "STANDBY GAP"}
    </div>
  );
}

function ConnectionBadge({ status }: { status: StatusResponse["wsStatus"] | "unknown" }) {
  const label =
    status === "online"
      ? "Websocket online"
      : status === "reconnecting"
        ? "Websocket reconnecting..."
        : status === "connecting"
          ? "Connecting..."
          : status === "offline"
            ? "Websocket offline"
            : "Websocket offline";
  const ok = status === "online";
  return (
    <span className={`connection-badge${ok ? "" : " connection-badge--warn"}`}>
      <span className="connection-badge__dot" />
      {label}
    </span>
  );
}
