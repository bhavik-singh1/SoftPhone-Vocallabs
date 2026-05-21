// Maps a call to the app-user who owns it. The shared SIP line carries calls
// for all users, so AMI alone can't tell whose call it is. Two signals:
//   * OUTBOUND: the dashboard POSTs /api/calls/claim with the number right
//     before dialing; we hold that claim briefly and attach it to the next
//     matching new channel.
//   * INBOUND: there's no dialer, so we attribute it to the agent currently at
//     the dashboard (the latest connected WS client) — see ws.currentAgent().
import { currentAgent } from "./ws.js";

const CLAIM_TTL_MS = 15000;
const claims = []; // { number, username, ts }

export function claimOutbound(username, number) {
  const norm = normalize(number);
  claims.push({ number: norm, username, ts: Date.now() });
  // Prune stale claims so they can't mis-tag a much later call.
  const cutoff = Date.now() - CLAIM_TTL_MS;
  while (claims.length && claims[0].ts < cutoff) claims.shift();
}

// Find (and consume) the owner for a newly-seen outbound call to `number`.
export function takeOutboundOwner(number) {
  const norm = normalize(number);
  const cutoff = Date.now() - CLAIM_TTL_MS;
  for (let i = 0; i < claims.length; i++) {
    const c = claims[i];
    if (c.ts >= cutoff && c.number === norm) {
      claims.splice(i, 1);
      return c.username;
    }
  }
  // Fall back to the agent at the dashboard if no exact claim matched.
  return currentAgent();
}

// Owner for an inbound call: whoever is at the dashboard.
export function inboundOwner() {
  return currentAgent();
}

// Compare by the trailing significant digits so "0" prefixes / +country codes
// in the dialplan don't break the match against what the user typed.
function normalize(n) {
  return String(n || "").replace(/\D/g, "").slice(-10);
}
