import express from "express";
import cors from "cors";
import http from "http";
import { config } from "./config.js";
import { initDb } from "./db.js";
import { login } from "./auth.js";
import { sipRouter } from "./routes/sip.js";
import { callsRouter } from "./routes/calls.js";
import { attachWs } from "./ws.js";
import { startAmi } from "./ami.js";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.post("/api/login", login);
app.use("/api", sipRouter);
app.use("/api", callsRouter);

const server = http.createServer(app);
attachWs(server); // live call-state push at /ws

async function main() {
  await initDb();
  startAmi(); // begin bridging Asterisk AMI events → DB + browsers
  server.listen(config.port, () => {
    console.log(`[backend] listening on :${config.port}`);
  });
}

main().catch((err) => {
  console.error("[backend] fatal:", err);
  process.exit(1);
});
