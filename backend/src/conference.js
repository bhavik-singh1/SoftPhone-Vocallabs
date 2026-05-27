import crypto from "crypto";
import { config } from "./config.js";
import { getAmi } from "./ami.js";
import { broadcast } from "./ws.js";
import { upsertCall } from "./db.js";

// "Call two numbers at once" (multi-call conference).
//
// Flow, all driven from here over AMI:
//   1. Make a room id.
//   2. Originate the BROWSER leg: PJSIP/<softphone_user> -> on answer lands in
//      conf-join,<room> (the browser rings exactly like an inbound call and the
//      user accepts on the dashboard).
//   3. Originate EACH PSTN number: PJSIP/<prefix><number>@trunk -> on answer
//      lands in conf-dial,<room>. All legs share the one ConfBridge mix.
//   A leg that never answers just never joins; the call continues with the rest.
//
// Per-leg state (ringing/answered/no-answer/ended) is derived from
// OriginateResponse + Hangup events and pushed to the owner's browser over WS.

const TRUNK_PREFIX = config.trunk?.prefix ?? process.env.TRUNK_PREFIX ?? "";
const SOFTPHONE = config.sip.user;

// roomId -> { owner, legs: { browser, phone_1, phone_2 }, createdAt }
const rooms = new Map();
// actionId -> { room, key, number }  (correlates OriginateResponse back to a leg)
const pending = new Map();
// channel -> { room, key }           (correlates Hangup back to a leg)
const channels = new Map();

const newId = () => "conf-" + crypto.randomBytes(5).toString("hex");
const get = (evt, k) => evt[k] ?? evt[k?.toLowerCase?.()] ?? evt[k?.toUpperCase?.()];

function pushLeg(room, key, patch) {
  const r = rooms.get(room);
  if (!r) return;
  r.legs[key] = { ...(r.legs[key] || {}), ...patch };
  broadcast({
    kind: "conference",
    room,
    owner: r.owner,
    legs: r.legs,
  });
}

// Normalize a number for dialing: strip spaces; the dialplan prepends the trunk
// prefix, so we pass the bare number (allow a leading +).
function dialString(number) {
  const n = String(number).trim().replace(/[^\d+]/g, "");
  return `PJSIP/${TRUNK_PREFIX}${n.replace(/^\+/, "")}@trunk`;
}

// Start a two-number conference for `owner`. Returns the room id immediately;
// leg progress arrives via WS "conference" events.
export function startConference(owner, phone1, phone2) {
  const ami = getAmi();
  if (!ami) throw new Error("AMI not connected");
  const room = newId();
  rooms.set(room, {
    owner,
    createdAt: Date.now(),
    legs: {
      browser: { role: "you", status: "ringing" },
      phone_1: { number: phone1, status: "ringing" },
      phone_2: { number: phone2, status: "ringing" },
    },
  });

  // 1) Ring the browser into the room (acts like an inbound call to accept).
  originateLeg(room, "browser", `PJSIP/${SOFTPHONE}`, "conf-join", room, owner);
  // 2) Ring both PSTN numbers into the same room.
  if (phone1) originateLeg(room, "phone_1", dialString(phone1), "conf-dial", room, owner, phone1);
  if (phone2) originateLeg(room, "phone_2", dialString(phone2), "conf-dial", room, owner, phone2);

  return room;
}

function originateLeg(room, key, channel, context, exten, owner, number) {
  const ami = getAmi();
  const actionId = `${room}:${key}:${crypto.randomBytes(3).toString("hex")}`;
  pending.set(actionId, { room, key, number });

  ami.action(
    {
      action: "Originate",
      actionid: actionId,
      channel,
      context,
      exten,
      priority: 1,
      // 45s ring; async so all legs ring in parallel (don't block on the first).
      timeout: 45000,
      async: "true",
      callerid: number ? `${number}` : owner,
      // Tag the eventual channel so Hangup correlation can find the room/leg.
      variable: `CONFROOM=${room},CONFLEG=${key}`,
    },
    (err, res) => {
      if (err) {
        pushLeg(room, key, { status: "failed" });
        pending.delete(actionId);
      }
    }
  );
}

// Hang up every leg of a room (end the conference).
export function endConference(owner, room) {
  const ami = getAmi();
  const r = rooms.get(room);
  if (!r || r.owner !== owner) return false;
  // Hang up by the channel var group: kick everyone in this ConfBridge.
  ami.action({ action: "ConfbridgeKick", conference: room, channel: "all" }, () => {});
  // Also hang up any channels we tracked (covers still-ringing legs).
  for (const [ch, info] of channels) {
    if (info.room === room) ami.action({ action: "Hangup", channel: ch }, () => {});
  }
  rooms.delete(room);
  broadcast({ kind: "conference", room, owner, legs: r.legs, ended: true });
  return true;
}

export function ownsRoom(owner, room) {
  const r = rooms.get(room);
  return !!r && r.owner === owner;
}

// Wire conference-specific AMI events. Call once from startAmi-side setup.
export function attachConferenceEvents(ami) {
  ami.on("managerevent", (evt) => {
    const event = get(evt, "event");

    if (event === "OriginateResponse") {
      const actionId = get(evt, "actionid");
      const p = pending.get(actionId);
      if (!p) return;
      const reason = String(get(evt, "reason"));
      const channel = get(evt, "channel");
      // asterisk reason: 4 = answered, others = failed/busy/noanswer/congestion
      if (reason === "4") {
        if (channel) channels.set(channel, { room: p.room, key: p.key });
        pushLeg(p.room, p.key, { status: "answered", channel });
      } else {
        pushLeg(p.room, p.key, { status: "no-answer" });
      }
      pending.delete(actionId);
      return;
    }

    if (event === "ConfbridgeJoin") {
      const channel = get(evt, "channel");
      const room = get(evt, "conference");
      const tracked = channels.get(channel);
      if (tracked && tracked.room === room) {
        pushLeg(room, tracked.key, { status: "in" });
      }
      return;
    }

    if (event === "Hangup") {
      const channel = get(evt, "channel");
      const tracked = channels.get(channel);
      if (!tracked) return;
      channels.delete(channel);
      pushLeg(tracked.room, tracked.key, { status: "ended" });
      // If no legs remain joined, drop the room.
      const r = rooms.get(tracked.room);
      if (r) {
        const anyLive = Object.values(r.legs).some(
          (l) => l.status === "in" || l.status === "answered" || l.status === "ringing"
        );
        if (!anyLive) {
          rooms.delete(tracked.room);
          broadcast({ kind: "conference", room: tracked.room, owner: r.owner, legs: r.legs, ended: true });
        }
      }
      return;
    }
  });
}
