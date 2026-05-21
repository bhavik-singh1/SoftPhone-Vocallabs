import { Router } from "express";
import crypto from "crypto";
import { requireAuth } from "../auth.js";
import { config } from "../config.js";

export const sipRouter = Router();

// Time-limited TURN credential (coturn "use-auth-secret" / TURN REST API).
function turnCredentials() {
  const ttl = 3600;
  const username = `${Math.floor(Date.now() / 1000) + ttl}:${config.sip.user}`;
  const credential = crypto
    .createHmac("sha1", config.turn.secret)
    .update(username)
    .digest("base64");
  return { username, credential };
}

// Everything the browser needs to register as a SIP endpoint over WSS.
// NOTE: the softphone password is necessarily exposed to the browser (it is a
// real SIP client). Keep this account distinct from the trunk, and in
// production issue short-lived per-session SIP credentials instead.
sipRouter.get("/sip-config", requireAuth, (req, res) => {
  res.json({
    wsServer: config.sip.wsServer,
    sipUri: `sip:${config.sip.user}@${config.sip.publicHost}`,
    authorizationUser: config.sip.user,
    password: config.sip.password,
    displayName: config.sip.user,
    iceServers: buildIceServers(),
    // Display-only: the agent's inbound DID and outbound caller-ID numbers.
    numbers: config.numbers,
  });
});

// Prefer an external managed TURN (metered.ca) when configured — it lives on a
// different public IP, so RTPEngine's outbound is cleanly NAT'd to the VPS's
// public IP (no same-host hairpin) and relay works on any client network,
// including CGNAT/mobile. Falls back to the on-host coturn otherwise.
function buildIceServers() {
  const m = config.meteredTurn;
  if (m.user && m.cred) {
    return [
      { urls: "stun:stun.relay.metered.ca:80" },
      { urls: `turn:${m.host}:80`, username: m.user, credential: m.cred },
      { urls: `turn:${m.host}:80?transport=tcp`, username: m.user, credential: m.cred },
      { urls: `turn:${m.host}:443`, username: m.user, credential: m.cred },
      { urls: `turns:${m.host}:443?transport=tcp`, username: m.user, credential: m.cred },
    ];
  }
  const { username, credential } = turnCredentials();
  return [
    { urls: `stun:${config.turn.publicIp}:3478` },
    { urls: `turn:${config.turn.publicIp}:3478?transport=udp`, username, credential },
  ];
}
