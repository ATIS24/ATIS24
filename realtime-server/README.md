# ATIS Radio — realtime-server

The current backend: a persistent Node/Express process. This is the
piece that makes Discord auth and live ATIS push actually work — neither
is possible in a Vercel-style serverless function (see the root
`README.md` "Why two backends exist" section for the full reasoning).

## What this process owns

- **One** server-side WebSocket connection to `wss://24data.ptfs.app/wss`
  (`src/atis/wsClient.ts`) — reconnects with exponential backoff, forces
  a reconnect if no message arrives within 45s, and resyncs from
  `GET /atis` on every (re)connect so nothing is missed while offline.
- An in-memory ATIS cache (`src/atis/store.ts`), keyed by **airport code**
  (not ATIS letter — letters repeat across airports). Emits `add` /
  `update` / `remove` deltas only when an airport's `letter + content`
  fingerprint actually changes.
- Discord OAuth2 (`src/auth/discord.ts`, `src/routes/auth.ts`) —
  authorization-code flow, CSRF-protected via a `state` cookie, client
  secret read only from `process.env` and never returned in any response.
- Session cookies (`src/auth/sessionStore.ts`, `src/auth/cookies.ts`) —
  opaque random tokens, HTTP-only + Secure (in production) + SameSite,
  10-day sliding expiry enforced server-side, swept hourly.
- Optional Discord guild-membership gating (`checkGuildMembership` in
  `src/auth/discord.ts`) — only active when `DISCORD_GUILD_ID` is set;
  otherwise every authenticated Discord user passes.

## Endpoints

| Route                          | Method | Auth required | Purpose |
|---------------------------------|--------|----------------|---------|
| `/api/health`                   | GET    | no             | Process liveness |
| `/api/auth/discord`             | GET    | no             | Starts OAuth, redirects to Discord |
| `/api/auth/discord/callback`    | GET    | no             | Discord redirects here; creates session |
| `/api/auth/me`                  | GET    | no (session optional) | Restores session on page load |
| `/api/auth/logout`              | POST   | no (session optional) | Invalidates session server-side |
| `/api/atis`                     | GET    | yes (+ guild)  | Full current ATIS list |
| `/api/atis/:airport`            | GET    | yes (+ guild)  | Single airport lookup |
| `/api/status`                   | GET    | no             | Real 24data WS connection state |
| `/api/stream`                   | GET    | yes (+ guild)  | SSE: snapshot + live deltas |

"yes (+ guild)" means: requires a valid session, and if `DISCORD_GUILD_ID`
is configured, also requires that the session's guild check passed.

## Environment variables

See `.env.example` for the full list with inline explanations. Required
for OAuth to work at all: `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`,
`DISCORD_REDIRECT_URI`, `FRONTEND_URL`. `DISCORD_GUILD_ID` is optional.

**`DISCORD_REDIRECT_URI` must point at this server**, not the frontend —
it's where Discord sends the user back after they approve the login, and
must be registered exactly (including scheme and path) in your Discord
application's OAuth2 settings.

## Local development

```bash
npm install
cp .env.example .env    # fill in Discord app credentials
npm run dev              # tsx watch — restarts on file changes
```

## Deployment

This needs a host that keeps a Node process running continuously —
**not** a serverless/functions-as-a-service product. Reasonable options:
Fly.io, Railway, Render, a Docker container on any VPS, a plain
systemd/pm2-managed process on a VPS.

```bash
npm run build   # tsc -> dist/
npm start       # node dist/server.js
```

Whichever host you choose, set the same environment variables as local
dev, but with real values: `DISCORD_REDIRECT_URI` and `FRONTEND_URL`
pointing at your actual deployed URLs (not localhost), and
`NODE_ENV=production` so session cookies get `Secure` set correctly
(requires HTTPS in front of this process — put it behind a reverse proxy
or your host's built-in TLS termination).

## Scaling note

Sessions and the ATIS cache are both in-process memory, which is
correct for a single instance (this is a genuinely long-lived process,
unlike the old serverless backend). If you ever need multiple instances
behind a load balancer, both `src/auth/sessionStore.ts` and
`src/atis/store.ts` have small, self-contained interfaces — swap them for
Redis-backed implementations without touching the routes or the
WebSocket client.
