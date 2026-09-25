import type { NextFunction, Request, Response } from "express";
import { sessionStore, type Session } from "./sessionStore.js";
import { readSessionToken, clearSessionCookie } from "./cookies.js";

declare module "express-serve-static-core" {
  interface Request {
    session?: Session;
  }
}

/** Resolves the session (if any) onto req.session, sliding its expiry.
 * Does NOT reject the request — routes decide what to do with an absent
 * session. This keeps public endpoints (e.g. /api/health) usable without
 * duplicating cookie-reading logic. */
export function resolveSession(req: Request, res: Response, next: NextFunction): void {
  const token = readSessionToken(req);
  if (!token) return next();

  const session = sessionStore.touch(token);
  if (!session) {
    // Token present but expired/unknown — proactively clear the stale
    // cookie so the browser stops sending it.
    clearSessionCookie(res);
    return next();
  }

  req.session = session;
  next();
}

/** Rejects the request with 401 unless a valid session is present.
 * Guild-membership enforcement (when configured) is separate — see
 * requireGuildMembership — since "authenticated" and "authorized for
 * this community" are different failure states the frontend should be
 * able to tell apart. */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.session) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  next();
}

/** When DISCORD_GUILD_ID is configured, rejects requests from
 * authenticated users who aren't members of that guild. When guild
 * verification isn't configured, this is a no-op (guildVerified stays
 * null and every authenticated user passes) — see auth/discord.ts. */
export function requireGuildMembership(req: Request, res: Response, next: NextFunction): void {
  if (!req.session) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  if (req.session.guildVerified === false) {
    res.status(403).json({ error: "Not a member of the required Discord community" });
    return;
  }
  next();
}
