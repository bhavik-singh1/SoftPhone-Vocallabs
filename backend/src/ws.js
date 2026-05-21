import { WebSocketServer } from "ws";
import { verifyToken } from "./auth.js";

// A small pub/sub hub: the browser opens ws(s)://backend/ws?token=JWT and
// receives live call-state events forwarded from AMI (see ami.js). Each socket
// is tagged with its app-user so events can be addressed per-user, and so an
// inbound call can be attributed to the currently-connected agent(s).
let wss = null;
const clients = new Set(); // { socket, username }

export function attachWs(server) {
  wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (socket, req) => {
    const url = new URL(req.url, "http://localhost");
    const token = url.searchParams.get("token");
    const claims = verifyToken(token);
    if (!claims) {
      socket.close(4001, "unauthorized");
      return;
    }
    const client = { socket, username: claims.sub };
    clients.add(client);
    socket.send(JSON.stringify({ type: "hello", ts: Date.now() }));
    socket.on("close", () => clients.delete(client));
    socket.on("error", () => clients.delete(client));
  });

  console.log("[ws] live-event WebSocket server attached at /ws");
}

// The most recently-connected user — the agent at the dashboard right now.
// Used to attribute an inbound call (the shared SIP line rings whoever is here).
export function currentAgent() {
  let latest = null;
  for (const c of clients) latest = c; // Set preserves insertion order
  return latest ? latest.username : null;
}

// Broadcast a normalized call event. If the event names an `owner`, deliver it
// only to that user's sockets; otherwise broadcast to everyone (e.g. hello).
export function broadcast(event) {
  const payload = JSON.stringify({ type: "call", ...event });
  for (const c of clients) {
    if (c.socket.readyState !== c.socket.OPEN) continue;
    if (event.owner && c.username !== event.owner) continue;
    c.socket.send(payload);
  }
}
