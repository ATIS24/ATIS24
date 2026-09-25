/**
 * Discord OAuth2 client.
 *
 * CRITICAL: DISCORD_CLIENT_SECRET is read from process.env only, used
 * only in server-to-Discord requests (never echoed to the client), and
 * is never present in any response body sent to the browser. The
 * frontend only ever sees the opaque session cookie — never a Discord
 * access token, refresh token, or the client secret.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const DISCORD_API = "https://discord.com/api/v10";
const STATE_MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function getDiscordClientId(): string {
  return requireEnv("DISCORD_CLIENT_ID");
}

function getDiscordClientSecret(): string {
  return requireEnv("DISCORD_CLIENT_SECRET");
}

export function getOAuthRedirectUri(): string {
  return requireEnv("DISCORD_REDIRECT_URI");
}

/**
 * Stateless CSRF "state" for the OAuth flow.
 *
 * The frontend lives on GitHub Pages and now links straight to
 * discord.com (it never visits this server as a page), so there is no
 * request/response round trip on this domain in which to set a cookie
 * before the browser leaves for Discord. Instead we hand out a
 * self-contained, signed token: `<random>.<timestamp>.<hmac>`. The
 * callback re-derives the HMAC with the server-only secret and checks
 * the timestamp, so it can verify the state came from us and hasn't
 * expired, with nothing stored server-side and no cookie needed.
 */
function getStateSecret(): string {
  return requireEnv("OAUTH_STATE_SECRET");
}

function signState(payload: string): string {
  return createHmac("sha256", getStateSecret()).update(payload).digest("hex");
}

export function createOAuthState(): string {
  const nonce = randomBytes(16).toString("hex");
  const timestamp = Date.now().toString();
  const payload = `${nonce}.${timestamp}`;
  return `${payload}.${signState(payload)}`;
}

export function verifyOAuthState(state: string): boolean {
  const parts = state.split(".");
  if (parts.length !== 3) return false;
  const [nonce, timestamp, signature] = parts;
  if (!nonce || !timestamp || !signature) return false;
  const payload = `${nonce}.${timestamp}`;
  const expected = signState(payload);

  const sigBuf = Buffer.from(signature, "hex");
  const expectedBuf = Buffer.from(expected, "hex");
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
    return false;
  }

  const age = Date.now() - Number(timestamp);
  return Number.isFinite(age) && age >= 0 && age <= STATE_MAX_AGE_MS;
}

export function buildDiscordAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: getDiscordClientId(),
    redirect_uri: getOAuthRedirectUri(),
    response_type: "code",
    // "identify" alone covers username, avatar, and banner (Discord has
    // no separate banner scope — all three come back on /users/@me under
    // "identify"). "guilds" is intentionally NOT requested: this app
    // isn't using server-side guild-membership verification right now.
    // If you later set DISCORD_GUILD_ID to enable that feature, add
    // "guilds" back here or checkGuildMembership() will fail for
    // everyone.
    scope: "identify",
    state,
    prompt: "consent",
  });
  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  scope: string;
}

export async function exchangeCodeForToken(code: string): Promise<TokenResponse> {
  const body = new URLSearchParams({
    client_id: getDiscordClientId(),
    client_secret: getDiscordClientSecret(), // server-side only, never leaves this function's scope
    grant_type: "authorization_code",
    code,
    redirect_uri: getOAuthRedirectUri(),
  });

  const res = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Discord token exchange failed (${res.status}): ${text}`);
  }

  return (await res.json()) as TokenResponse;
}

interface DiscordUserResponse {
  id: string;
  username: string;
  global_name: string | null;
  avatar: string | null;
  banner: string | null;
}

export async function fetchDiscordUser(accessToken: string): Promise<DiscordUserResponse> {
  const res = await fetch(`${DISCORD_API}/users/@me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Discord /users/@me failed with ${res.status}`);
  }
  return (await res.json()) as DiscordUserResponse;
}

interface DiscordGuildMembership {
  id: string;
}

/**
 * Server-side guild membership check. Uses the user's OAuth access token
 * (scope "guilds") to list guilds they belong to, and checks whether the
 * configured DISCORD_GUILD_ID is among them. Never trusts anything the
 * frontend claims about membership — this is the only source of truth.
 *
 * Returns null (not false) when DISCORD_GUILD_ID isn't configured, so
 * callers can distinguish "verification not enabled" from "verified and
 * failed".
 */
export async function checkGuildMembership(accessToken: string): Promise<boolean | null> {
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!guildId) return null;

  const res = await fetch(`${DISCORD_API}/users/@me/guilds`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Discord /users/@me/guilds failed with ${res.status}`);
  }
  const guilds = (await res.json()) as DiscordGuildMembership[];
  return guilds.some((g) => g.id === guildId);
}
