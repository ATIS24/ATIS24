/**
 * Discord OAuth2 client.
 *
 * CRITICAL: DISCORD_CLIENT_SECRET is read from process.env only, used
 * only in server-to-Discord requests (never echoed to the client), and
 * is never present in any response body sent to the browser. The
 * frontend only ever sees the opaque session cookie — never a Discord
 * access token, refresh token, or the client secret.
 */

const DISCORD_API = "https://discord.com/api/v10";

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

export function buildDiscordAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: getDiscordClientId(),
    redirect_uri: getOAuthRedirectUri(),
    response_type: "code",
    // Only what the app actually uses: username + avatar + banner.
    // ("guilds" was dropped along with the guild-membership gate below.)
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
