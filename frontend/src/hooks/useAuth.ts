import { useCallback, useEffect, useState } from "react";
import { fetchAuthMe, logout as apiLogout, type AuthMeResponse } from "../lib/api";

export type AuthStatus = "checking" | "authenticated" | "unauthenticated" | "forbidden";

interface UseAuthResult {
  status: AuthStatus;
  user: AuthMeResponse["user"] | null;
  guildVerified: boolean | null;
  refresh: () => Promise<void>;
  logout: () => Promise<void>;
}

/**
 * Restores and tracks the authenticated session.
 *
 * On mount, calls GET /api/auth/me — this is what "restores the session
 * automatically when the page is refreshed" (per spec): the browser
 * sends the HTTP-only session cookie automatically, the backend
 * validates it server-side, and we reflect the result here. There is no
 * localStorage involved at any point.
 */
export function useAuth(): UseAuthResult {
  const [status, setStatus] = useState<AuthStatus>("checking");
  const [user, setUser] = useState<AuthMeResponse["user"] | null>(null);
  const [guildVerified, setGuildVerified] = useState<boolean | null>(null);

  const refresh = useCallback(async () => {
    setStatus("checking");
    try {
      const me = await fetchAuthMe();
      if (!me.authenticated || !me.user) {
        setUser(null);
        setGuildVerified(null);
        setStatus("unauthenticated");
        return;
      }
      setUser(me.user);
      setGuildVerified(me.guildVerified ?? null);
      // guildVerified === false means: authenticated, but the backend
      // has confirmed (server-side) that this user isn't in the
      // configured community — show a clear message, not the radio.
      setStatus(me.guildVerified === false ? "forbidden" : "authenticated");
    } catch {
      setUser(null);
      setGuildVerified(null);
      setStatus("unauthenticated");
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const logout = useCallback(async () => {
    await apiLogout();
    setUser(null);
    setGuildVerified(null);
    setStatus("unauthenticated");
  }, []);

  return { status, user, guildVerified, refresh, logout };
}
