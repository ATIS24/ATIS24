import { Router } from "express";
import {
  buildDiscordAuthorizeUrl,
  createOAuthState,
  verifyOAuthState,
  exchangeCodeForToken,
  fetchDiscordUser,
  checkGuildMembership,
} from "../auth/discord.js";
import { sessionStore } from "../auth/sessionStore.js";
import { setSessionCookie, clearSessionCookie, readSessionToken } from "../auth/cookies.js";

export const authRouter = Router();

/** GET /api/auth/discord/url — returns the Discord authorize URL as
 * JSON (with a signed, stateless CSRF "state" baked in — see
 * createOAuthState). The frontend fetches this and navigates the
 * browser to it directly, so the user goes straight from GitHub Pages
 * to discord.com and never visits this server as a page. */
authRouter.get("/discord/url", (req, res) => {
  const state = createOAuthState();
  res.json({ url: buildDiscordAuthorizeUrl(state) });
});

/** GET /api/auth/discord — legacy redirect-based entry point, kept as
 * a fallback (e.g. for opening the link directly / no-JS). Not used by
 * the current frontend, which calls /discord/url instead. */
authRouter.get("/discord", (req, res) => {
  const state = createOAuthState();
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

    if (!code || !state || !verifyOAuthState(state)) {
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
        banner: discordUser.banner,
      },
      guildVerified,
    );

    setSessionCookie(res, session.token);
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
