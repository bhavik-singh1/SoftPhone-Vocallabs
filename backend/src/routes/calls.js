import { Router } from "express";
import fs from "fs";
import path from "path";
import { requireAuth } from "../auth.js";
import { config } from "../config.js";
import { listCalls } from "../db.js";
import { claimOutbound } from "../ownership.js";

export const callsRouter = Router();

// Paginated call history for the logged-in user. ?page=1&pageSize=15
callsRouter.get("/calls", requireAuth, async (req, res) => {
  try {
    const pageSize = clamp(parseInt(req.query.pageSize, 10) || 15, 1, 50);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const { items, total } = await listCalls(req.user.sub, {
      limit: pageSize,
      offset: (page - 1) * pageSize,
    });
    res.json({ items, total, page, pageSize });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// The dashboard calls this right before dialing so the resulting outbound call
// is attributed to this user (the shared SIP line can't tell us otherwise).
callsRouter.post("/calls/claim", requireAuth, (req, res) => {
  const number = (req.body && req.body.number) || "";
  if (!number) return res.status(400).json({ error: "number required" });
  claimOutbound(req.user.sub, number);
  res.json({ ok: true });
});

// Stream a recording for playback/download. uniqueid is the Asterisk channel
// id (e.g. "1716240000.5"); recordings are saved as "<uniqueid>.wav".
callsRouter.get("/recordings/:uniqueid", requireAuth, (req, res) => {
  const id = req.params.uniqueid;
  // Sanitize: only word chars, dots, dashes — blocks path traversal.
  if (!/^[\w.\-]+$/.test(id)) {
    return res.status(400).json({ error: "bad id" });
  }
  const file = path.join(config.recordingsDir, `${id}.wav`);
  if (!file.startsWith(config.recordingsDir) || !fs.existsSync(file)) {
    return res.status(404).json({ error: "recording not found" });
  }
  res.setHeader("Content-Type", "audio/wav");
  fs.createReadStream(file).pipe(res);
});

function clamp(n, lo, hi) {
  return Math.min(Math.max(n, lo), hi);
}
