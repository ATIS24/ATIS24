/**
 * Server-side session store.
 *
 * Sessions are opaque random tokens held ONLY server-side (in this
 * process's memory) and referenced by an HTTP-only, Secure, SameSite
 * cookie on the client. The frontend never sees the session's contents —
 * just an opaque cookie the browser sends automatically.
 *
 * Expiration policy: 10 days of inactivity. Every authenticated request
 * that resolves a valid session slides its expiry forward (touch()), so
 * an actively-used session stays alive, while an abandoned one expires
 * exactly 10 days after its last use — matching "10 days of
 * inactivity/use" from the spec, not a flat 10-days-since-login policy.
 *
 * This is process-memory, matching the rest of this server's design (one
 * persistent process = legitimate source of truth). If you later run
 * multiple instances behind a load balancer, swap this for a shared
 * store (Redis) — the interface below is intentionally small so that's a
 * contained change.
 */

import { randomBytes } from "node:crypto";

export interface DiscordProfile {
  id: string;
  username: string;
  globalName: string | null;
  avatar: string | null;
}

export interface Session {
  token: string;
  user: DiscordProfile;
  createdAt: number;
  lastActiveAt: number;
  expiresAt: number;
  /** Only meaningful when guild verification is configured (see
   * guildCheck.ts). Null = not checked / not configured. */
  guildVerified: boolean | null;
}

const SESSION_TTL_MS = 10 * 24 * 60 * 60 * 1000; // 10 days

class SessionStore {
  private sessions = new Map<string, Session>();

  create(user: DiscordProfile, guildVerified: boolean | null): Session {
    const token = randomBytes(32).toString("hex");
    const now = Date.now();
    const session: Session = {
      token,
      user,
      createdAt: now,
      lastActiveAt: now,
      expiresAt: now + SESSION_TTL_MS,
      guildVerified,
    };
    this.sessions.set(token, session);
    return session;
  }

  /** Resolves a session by token, enforcing expiry server-side. Returns
   * null (and deletes the record) if the session has expired — the
   * caller is responsible for clearing the client's cookie in that case.
   * On success, slides the expiry forward another 10 days from now. */
  touch(token: string): Session | null {
    const session = this.sessions.get(token);
    if (!session) return null;
    const now = Date.now();
    if (now > session.expiresAt) {
      this.sessions.delete(token);
      return null;
    }
    session.lastActiveAt = now;
    session.expiresAt = now + SESSION_TTL_MS;
    return session;
  }

  destroy(token: string): void {
    this.sessions.delete(token);
  }

  /** Periodic sweep of expired sessions so memory doesn't grow
   * unbounded from abandoned logins. */
  sweepExpired(): number {
    const now = Date.now();
    let removed = 0;
    for (const [token, session] of this.sessions) {
      if (now > session.expiresAt) {
        this.sessions.delete(token);
        removed += 1;
      }
    }
    return removed;
  }

  size(): number {
    return this.sessions.size;
  }
}

export const sessionStore = new SessionStore();

// Sweep hourly — cheap, keeps memory bounded without needing a cron.
setInterval(() => sessionStore.sweepExpired(), 60 * 60 * 1000).unref();
