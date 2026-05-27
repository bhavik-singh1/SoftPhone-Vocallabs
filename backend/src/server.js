import express from "express";
import cors from "cors";
import http from "http";
import { config } from "./config.js";
import { initDb } from "./db.js";
import { login } from "./auth.js";
import { sipRouter } from "./routes/sip.js";
import { callsRouter } from "./routes/calls.js";
import { conferenceRouter } from "./routes/conference.js";
import { attachWs } from "./ws.js";
import { startAmi } from "./ami.js";
import { attachConferenceEvents } from "./conference.js";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.post("/api/login", login);
app.use("/api", sipRouter);
app.use("/api", callsRouter);
app.use("/api", conferenceRouter);

const server = http.createServer(app);
attachWs(server); // live call-state push at /ws

async function main() {
  await initDb();
  const ami = startAmi(); // begin bridging Asterisk AMI events → DB + browsers
  attachConferenceEvents(ami); // conference leg tracking (OriginateResponse/Join/Hangup)
  server.listen(config.port, () => {
    console.log(`[backend] listening on :${config.port}`);
  });
}

main().catch((err) => {
  console.error("[backend] fatal:", err);
  process.exit(1);
});
