import { Router } from "express";
import { requireAuth } from "../auth.js";
import { startConference, endConference, ownsRoom } from "../conference.js";

export const conferenceRouter = Router();

// Start a "call two numbers at once" conference. Mirrors the example shape
// { phone_1, phone_2 } + Bearer token. Returns the room id; per-leg progress
// (ringing/answered/no-answer/in/ended) streams over the /ws "conference" event.
conferenceRouter.post("/conference/start", requireAuth, (req, res) => {
  const { phone_1, phone_2 } = req.body || {};
  if (!phone_1 && !phone_2) {
    return res.status(400).json({ error: "phone_1 and/or phone_2 required" });
  }
  try {
    const room = startConference(req.user.sub, phone_1, phone_2);
    res.json({ room });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// End the whole conference (hang up all legs).
conferenceRouter.post("/conference/:room/end", requireAuth, (req, res) => {
  const { room } = req.params;
  if (!ownsRoom(req.user.sub, room)) {
    return res.status(404).json({ error: "no such conference" });
  }
  endConference(req.user.sub, room);
  res.json({ ok: true });
});
