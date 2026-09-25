/**
 * Session cookie helpers. The cookie holds ONLY the opaque session
 * token (see sessionStore.ts) — never Discord tokens, never user data
 * directly, never anything that needs to be kept secret beyond "don't
 * let another site read this cookie" (which HttpOnly + SameSite handle).
 */

import { serialize, parse } from "cookie";
import type { Request, Response } from "express";

export const SESSION_COOKIE_NAME = "atis_session";
const TEN_DAYS_SECONDS = 10 * 24 * 60 * 60;

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

export function setSessionCookie(res: Response, token: string): void {
  res.setHeader(
    "Set-Cookie",
    serialize(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      secure: isProduction(),
      sameSite: "lax",
      path: "/",
      maxAge: TEN_DAYS_SECONDS,
    }),
  );
}

export function clearSessionCookie(res: Response): void {
  res.setHeader(
    "Set-Cookie",
    serialize(SESSION_COOKIE_NAME, "", {
      httpOnly: true,
      secure: isProduction(),
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    }),
  );
}

export function readSessionToken(req: Request): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  const parsed = parse(header);
  return parsed[SESSION_COOKIE_NAME] ?? null;
}
