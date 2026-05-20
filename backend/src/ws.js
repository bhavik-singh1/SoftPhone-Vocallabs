import { WebSocketServer } from "ws";
import { verifyToken } from "./auth.js";

// A small pub/sub hub: the browser opens ws(s)://backend/ws?token=JWT and
// receives live call-state events forwarded from AMI (see ami.js).
let wss = null;
const clients = new Set();

export function attachWs(server) {
  wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (socket, req) => {
    const url = new URL(req.url, "http://localhost");
    const token = url.searchParams.get("token");
    if (!verifyToken(token)) {
      socket.close(4001, "unauthorized");
      return;
    }
    clients.add(socket);
    socket.send(JSON.stringify({ type: "hello", ts: Date.now() }));
    socket.on("close", () => clients.delete(socket));
    socket.on("error", () => clients.delete(socket));
  });

  console.log("[ws] live-event WebSocket server attached at /ws");
}

// Broadcast a normalized call event to every connected browser.
export function broadcast(event) {
  const payload = JSON.stringify({ type: "call", ...event });
  for (const c of clients) {
    if (c.readyState === c.OPEN) c.send(payload);
  }
}
