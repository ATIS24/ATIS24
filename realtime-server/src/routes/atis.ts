import { Router } from "express";
import { atisStore } from "../atis/store";
import { requireGuildMembership } from "../auth/middleware";

export const atisRouter = Router();

/** GET /api/atis — full current ATIS list. Requires authentication (and
 * guild membership, if configured) — the radio itself is behind login. */
atisRouter.get("/atis", requireGuildMembership, (_req, res) => {
  const atis = atisStore.list();
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({
    atis,
    generatedAt: Date.now(),
    meta: { totalAirports: atis.length },
  });
});

/** GET /api/atis/:airport — single airport lookup, mainly useful for
 * debugging/tooling; the frontend primarily uses the full list + SSE. */
atisRouter.get("/atis/:airport", requireGuildMembership, (req, res) => {
  const airportParam = req.params.airport;
  if (!airportParam) {
    res.status(400).json({ error: "Missing airport code" });
    return;
  }
  const airport = airportParam.toUpperCase();
  const atis = atisStore.get(airport);
  if (!atis) {
    res.status(404).json({ error: "No ATIS for that airport" });
    return;
  }
  res.status(200).json({ atis });
});

/** GET /api/status — reports the REAL upstream WebSocket state, not
 * just "the server is up". The frontend's connection indicator is driven
 * entirely by this (and by the SSE stream's own liveness). */
atisRouter.get("/status", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({
    wsStatus: atisStore.wsStatus,
    lastWsMessageAt: atisStore.lastWsMessageAt,
    lastRestSyncAt: atisStore.lastRestSyncAt,
    airportCount: atisStore.list().length,
    now: Date.now(),
  });
});
