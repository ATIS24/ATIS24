import { useEffect } from "react";
import { RadioPanel } from "./components/RadioPanel";
import { LoginScreen } from "./components/LoginScreen";
import { useAtisRadio } from "./hooks/useAtisRadio";
import { useAuth } from "./hooks/useAuth";
import { useWsStatus } from "./hooks/useWsStatus";
import "./App.css";

export default function App() {
  const { status: authStatus, user, refresh: refreshAuth, logout } = useAuth();
  const isAuthenticated = authStatus === "authenticated";

  const {
    availableAirports,
    active,
    standby,
    activeStationState,
    power,
    receiving,
    tuneNext,
    tunePrev,
    togglePower,
    lastUpdatedAt,
    loadError,
  } = useAtisRadio(isAuthenticated);

  const wsStatus = useWsStatus(isAuthenticated);

  // After the Discord OAuth redirect lands back on the frontend, re-check
  // the session (the cookie is already set by the backend at this point)
  // and clean the URL. Handles both success (cookie now present) and the
  // ?auth_error= cases the backend redirects with on failure.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has("auth_error") || window.location.search.includes("code=")) {
      refreshAuth();
    }
    if (params.has("auth_error")) {
      // Leave the param for LoginScreen to read on this render, then
      // strip it from the URL so a refresh doesn't re-show the message.
      window.history.replaceState({}, "", window.location.pathname);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Left/right arrow keys mirror the physical ‹ › controls.
  useEffect(() => {
    if (!isAuthenticated) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.target instanceof HTMLElement && /input|textarea/i.test(e.target.tagName)) return;
      if (e.key === "ArrowRight") tuneNext();
      if (e.key === "ArrowLeft") tunePrev();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isAuthenticated, tuneNext, tunePrev]);

  if (authStatus === "checking") {
    return (
      <div className="app-shell app-shell--centered">
        <p className="app-loading-text">Connecting...</p>
      </div>
    );
  }

  if (authStatus === "unauthenticated") {
    const params = new URLSearchParams(window.location.search);
    return <LoginScreen errorReason={params.get("auth_error")} />;
  }

  if (authStatus === "forbidden") {
    return (
      <div className="app-shell app-shell--centered">
        <div className="login-screen__panel">
          <p className="app-forbidden-text">
            You're signed in, but this radio is restricted to a specific Discord community and
            your account isn't currently a member.
          </p>
          <button type="button" className="radio-panel__logout" onClick={logout}>
            Logout
          </button>
        </div>
      </div>
    );
  }

  const displayName = user?.globalName ?? user?.username ?? null;

  return (
    <div className="app-shell">
      <header className="app-header">
        <div>
          <h1>ATIS Radio</h1>
          <p className="app-header__sub">ATC24 · live ATIS via 24data</p>
        </div>
        {lastUpdatedAt && (
          <span className="app-header__updated">Updated {formatRelativeTime(lastUpdatedAt)}</span>
        )}
      </header>

      {loadError && (
        <div className="app-banner app-banner--error" role="alert">
          Having trouble reaching the ATIS data service — showing the most recent information
          available.
        </div>
      )}

      <main className="app-stage">
        <RadioPanel
          active={active}
          standby={standby}
          activeStationState={activeStationState}
          power={power}
          receiving={receiving}
          onTuneNext={tuneNext}
          onTunePrev={tunePrev}
          onTogglePower={togglePower}
          wsStatus={wsStatus}
          airportCount={availableAirports.length}
          username={displayName}
          onLogout={logout}
        />
      </main>

      <footer className="app-footer">
        <p>
          Unofficial fan tool. Not affiliated with ATC24 or PTFS. ATIS data sourced from the
          public 24data network for flight simulation use only.
        </p>
      </footer>
    </div>
  );
}

function formatRelativeTime(timestamp: number): string {
  const diffSeconds = Math.round((Date.now() - timestamp) / 1000);
  if (diffSeconds < 10) return "just now";
  if (diffSeconds < 60) return `${diffSeconds}s ago`;
  const diffMinutes = Math.round(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.round(diffMinutes / 60);
  return `${diffHours}h ago`;
}
