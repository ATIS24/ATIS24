import type { AtisListResponse } from "./types";

// Points at the persistent realtime-server (see /realtime-server), NOT
// the legacy Vercel serverless backend — that backend cannot hold the
// 24data WebSocket open, so authentication and live ATIS data are both
// served by realtime-server now. Set VITE_API_BASE_URL at build time.
const API_BASE = import.meta.env.VITE_API_BASE_URL || "http://localhost:8080";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { Accept: "application/json" },
    // Required so the HTTP-only session cookie is sent on cross-origin
    // requests from the GitHub Pages frontend to the realtime-server.
    credentials: "include",
  });
  if (!res.ok) {
    throw new ApiError(`Request to ${path} failed with ${res.status}`, res.status);
  }
  return (await res.json()) as T;
}

/** Fetches the current ATIS list. Requires an authenticated session —
 * the backend returns 401 otherwise (handled by useAuth/App gating so
 * this is only called once logged in). */
export function fetchAtisList(): Promise<AtisListResponse> {
  return getJson<AtisListResponse>("/api/atis");
}

export function streamUrl(): string {
  return `${API_BASE}/api/stream`;
}

export function discordLoginUrl(): string {
  return `${API_BASE}/api/auth/discord`;
}

export interface AuthMeResponse {
  authenticated: boolean;
  user?: {
    id: string;
    username: string;
    globalName: string | null;
    avatar: string | null;
  };
  guildVerified?: boolean | null;
  expiresAt?: number;
}

/** GET /api/auth/me — used on load to restore the session after a page
 * refresh (the session lives in an HTTP-only cookie, not localStorage,
 * so this call is what "restores" the logged-in UI state). Does NOT
 * throw on 401 — that's a normal "not logged in" response, not an error. */
export async function fetchAuthMe(): Promise<AuthMeResponse> {
  const res = await fetch(`${API_BASE}/api/auth/me`, {
    headers: { Accept: "application/json" },
    credentials: "include",
  });
  if (res.status === 401) {
    return { authenticated: false };
  }
  if (!res.ok) {
    throw new ApiError(`/api/auth/me failed with ${res.status}`, res.status);
  }
  return (await res.json()) as AuthMeResponse;
}

export async function logout(): Promise<void> {
  await fetch(`${API_BASE}/api/auth/logout`, {
    method: "POST",
    credentials: "include",
  });
}

export interface StatusResponse {
  wsStatus: "connecting" | "online" | "reconnecting" | "offline";
  lastWsMessageAt: number | null;
  lastRestSyncAt: number | null;
  airportCount: number;
  now: number;
}

export function fetchStatus(): Promise<StatusResponse> {
  return getJson<StatusResponse>("/api/status");
}
