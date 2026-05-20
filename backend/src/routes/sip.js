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
  const { username, credential } = turnCredentials();
  res.json({
    wsServer: `wss://${config.sip.publicHost}:${config.sip.wssPort}`,
    sipUri: `sip:${config.sip.user}@${config.sip.publicHost}`,
    authorizationUser: config.sip.user,
    password: config.sip.password,
    displayName: config.sip.user,
    iceServers: [
      { urls: `stun:${config.turn.publicIp}:3478` },
      {
        urls: `turn:${config.turn.publicIp}:3478?transport=udp`,
        username,
        credential,
      },
    ],
  });
});
