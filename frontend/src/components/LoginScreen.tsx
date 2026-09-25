import { useState } from "react";
import logo from "../assets/logo.jpg";
import loginBg from "../assets/login-bg.png";
import { fetchDiscordLoginUrl } from "../lib/api";

interface LoginScreenProps {
  errorReason?: string | null;
}

/** Discord's official brand mark, inline SVG — no external asset needed,
 * matches Discord's brand guidelines (single-color mark on a button). */
function DiscordMark() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.076.076 0 0 0-.04.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.06.06 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.211 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  );
}

export function LoginScreen({ errorReason }: LoginScreenProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLogin() {
    setLoading(true);
    setError(null);
    try {
      const url = await fetchDiscordLoginUrl();
      // Navigate straight to discord.com — no visible hop through the
      // backend's own domain first.
      window.location.href = url;
    } catch (err) {
      console.error("[login] Failed to start Discord OAuth flow:", err);
      setError("Couldn't start sign-in — please try again.");
      setLoading(false);
    }
  }

  return (
    <div className="login-screen" style={{ backgroundImage: `url(${loginBg})` }}>
      <div className="login-screen__scrim" />
      <div className="login-screen__panel">
        <img src={logo} alt="ATIS Radio" className="login-screen__logo" />

        {(errorReason || error) && (
          <p className="login-screen__error" role="alert">
            {error
              ? error
              : errorReason === "invalid_state"
                ? "Login session expired — please try again."
                : "Sign-in failed — please try again."}
          </p>
        )}

        <button
          type="button"
          className="login-screen__button"
          onClick={handleLogin}
          disabled={loading}
        >
          <DiscordMark />
          {loading ? "Redirecting…" : "Login with Discord"}
        </button>

        <p className="login-screen__footnote">
          Access requires a Discord account. Your session stays signed in for 10 days.
        </p>
      </div>
    </div>
  );
}
