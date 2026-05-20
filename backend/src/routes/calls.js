import { Router } from "express";
import fs from "fs";
import path from "path";
import { requireAuth } from "../auth.js";
import { config } from "../config.js";
import { listCalls } from "../db.js";

export const callsRouter = Router();

// Call history (CDR) for the dashboard.
callsRouter.get("/calls", requireAuth, async (req, res) => {
  try {
    res.json(await listCalls(100));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Stream a recording for playback/download. uniqueid is the Asterisk channel
// id (e.g. "1716240000.5"); recordings are saved as "<uniqueid>.wav".
callsRouter.get("/recordings/:uniqueid", requireAuth, (req, res) => {
  const id = req.params.uniqueid;
  // Sanitize: only digits, dots, dashes — blocks path traversal.
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
