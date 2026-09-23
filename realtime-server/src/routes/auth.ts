import { Router } from "express";
import { randomBytes } from "node:crypto";
import {
  buildDiscordAuthorizeUrl,
  exchangeCodeForToken,
  fetchDiscordUser,
  checkGuildMembership,
} from "../auth/discord.js";
import { sessionStore } from "../auth/sessionStore.js";
import { setSessionCookie, clearSessionCookie, readSessionToken } from "../auth/cookies.js";
import { serialize, parse } from "cookie";

export const authRouter = Router();

const OAUTH_STATE_COOKIE = "atis_oauth_state";

/** GET /api/auth/discord — starts the OAuth flow. Generates a random
 * "state" value, stores it in a short-lived cookie, and redirects the
 * browser to Discord's authorize page. The state is checked on callback
 * to prevent CSRF (an attacker tricking a user's browser into completing
 * an OAuth flow the attacker initiated). */
authRouter.get("/discord", (req, res) => {
  const state = randomBytes(16).toString("hex");
  res.setHeader(
    "Set-Cookie",
    serialize(OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 10 * 60, // 10 minutes — just long enough to complete the redirect round trip
    }),
  );
  res.redirect(buildDiscordAuthorizeUrl(state));
});

/** GET /api/auth/discord/callback — Discord redirects here with ?code
 * and ?state. Exchanges the code server-side (client secret never
 * leaves this handler), fetches the user's profile, optionally checks
 * guild membership, creates a session, sets the session cookie, and
 * redirects back to the frontend. */
authRouter.get("/discord/callback", async (req, res) => {
  const frontendUrl = process.env.FRONTEND_URL || "http://localhost:5173";

  try {
    const code = typeof req.query.code === "string" ? req.query.code : null;
    const state = typeof req.query.state === "string" ? req.query.state : null;
    const cookies = req.headers.cookie ? parse(req.headers.cookie) : {};
    const expectedState = cookies[OAUTH_STATE_COOKIE];

    if (!code || !state || !expectedState || state !== expectedState) {
      res.redirect(`${frontendUrl}/?auth_error=invalid_state`);
      return;
    }

    const tokenResponse = await exchangeCodeForToken(code);
    const discordUser = await fetchDiscordUser(tokenResponse.access_token);

    let guildVerified: boolean | null = null;
    try {
      guildVerified = await checkGuildMembership(tokenResponse.access_token);
    } catch (err) {
      // Guild check failing (Discord API hiccup) shouldn't hard-fail
      // login when membership enforcement isn't the point of failure —
      // treat as "unknown" rather than silently granting access.
      console.error("[auth] Guild membership check failed:", err);
      guildVerified = null;
    }

    const session = sessionStore.create(
      {
        id: discordUser.id,
        username: discordUser.username,
        globalName: discordUser.global_name,
        avatar: discordUser.avatar,
      },
      guildVerified,
    );

    setSessionCookie(res, session.token);
    // Clear the one-time OAuth state cookie now that the flow is complete.
    res.setHeader(
      "Set-Cookie",
      [
        res.getHeader("Set-Cookie"),
        serialize(OAUTH_STATE_COOKIE, "", { path: "/", maxAge: 0 }),
      ]
        .flat()
        .filter(Boolean) as string[],
    );

    res.redirect(frontendUrl);
  } catch (err) {
    console.error("[auth] Discord OAuth callback failed:", err);
    res.redirect(`${frontendUrl}/?auth_error=oauth_failed`);
  }
});

/** GET /api/auth/me — returns the current session's user, or 401. Used
 * by the frontend on load to restore the authenticated state after a
 * page refresh (the session cookie, not localStorage, is what makes
 * this work). */
authRouter.get("/me", (req, res) => {
  if (!req.session) {
    res.status(401).json({ authenticated: false });
    return;
  }
  res.status(200).json({
    authenticated: true,
    user: req.session.user,
    guildVerified: req.session.guildVerified,
    expiresAt: req.session.expiresAt,
  });
});

/** POST /api/auth/logout — invalidates the session server-side and
 * clears the cookie. */
authRouter.post("/logout", (req, res) => {
  const token = readSessionToken(req);
  if (token) {
    sessionStore.destroy(token);
  }
  clearSessionCookie(res);
  res.status(200).json({ ok: true });
});
