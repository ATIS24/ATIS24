/**
 * Entry point for the persistent realtime backend.
 *
 * This process:
 *  - holds ONE long-lived WebSocket connection to wss://24data.ptfs.app/wss
 *  - maintains an in-memory ATIS cache fed by that socket (+ REST resync)
 *  - handles Discord OAuth end-to-end (client secret never leaves this
 *    process)
 *  - issues HTTP-only cookie sessions with a 10-day sliding expiry
 *  - serves the frontend via authenticated REST + SSE endpoints
 *
 * Deploy this to anything that keeps a Node process alive: Fly.io,
 * Railway, Render, a plain VPS with systemd/pm2, a Docker container on
 * any host. Do NOT deploy this to Vercel serverless functions — see
 * README.md for why that's a hard architectural constraint, not a
 * preference.
 */

import express from "express";
import cors from "cors";
import { startAtc24RealtimeClient } from "./atis/wsClient";
import { resolveSession } from "./auth/middleware";
import { authRouter } from "./routes/auth";
import { atisRouter } from "./routes/atis";
import { streamRouter } from "./routes/stream";

const PORT = Number(process.env.PORT) || 8080;
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";

const app = express();

// Credentials must be enabled for the session cookie to flow on
// cross-origin requests from the GitHub Pages frontend, and the origin
// must be an exact match (not "*") for that to work per the CORS spec.
app.use(
  cors({
    origin: FRONTEND_URL,
    credentials: true,
  }),
);

app.use(express.json());
app.use(resolveSession);

app.get("/api/health", (_req, res) => {
  res.status(200).json({ ok: true, now: Date.now() });
});

app.use("/api/auth", authRouter);
app.use("/api", atisRouter);
app.use("/api", streamRouter);

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[server] Listening on port ${PORT}`);
  startAtc24RealtimeClient();
});

process.on("SIGTERM", () => {
  // eslint-disable-next-line no-console
  console.log("[server] SIGTERM received, shutting down");
  process.exit(0);
});
