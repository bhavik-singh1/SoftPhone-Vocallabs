import AsteriskManager from "asterisk-manager";
import { config } from "./config.js";
import { upsertCall } from "./db.js";
import { broadcast } from "./ws.js";

// In-memory state for calls currently in progress, keyed by the originating
// (softphone) channel's Uniqueid. CDRs are persisted to Postgres on changes.
const active = new Map();

// The softphone channel looks like "PJSIP/webrtc-00000001".
const SOFTPHONE_PREFIX = `PJSIP/${config.sip.user}-`;

// asterisk-manager lowercases event keys, but read defensively anyway.
const get = (evt, key) => evt[key] ?? evt[key.toLowerCase()] ?? evt[key.toUpperCase()];

function isSoftphoneChannel(channel = "") {
  return channel.startsWith(SOFTPHONE_PREFIX);
}

async function persistAndPush(call) {
  try {
    await upsertCall(call);
  } catch (err) {
    console.warn(`[ami] upsert failed: ${err.message}`);
  }
  broadcast(call);
}

export function startAmi() {
  const ami = AsteriskManager(
    config.ami.port,
    config.ami.host,
    config.ami.user,
    config.ami.password,
    true // listen for events
  );
  ami.keepConnected();

  ami.on("connect", () => console.log("[ami] connected to Asterisk"));
  ami.on("error", (err) => console.warn(`[ami] error: ${err?.message || err}`));

  ami.on("managerevent", (evt) => {
    const event = get(evt, "event");
    switch (event) {
      case "Newchannel":
        return onNewchannel(evt);
      case "DialBegin":
        return onDialBegin(evt);
      case "Newstate":
        return onNewstate(evt);
      case "Hangup":
        return onHangup(evt);
      default:
        return;
    }
  });

  return ami;
}

// A new softphone channel in the outbound context = a dial just started.
function onNewchannel(evt) {
  const channel = get(evt, "channel") || "";
  const context = get(evt, "context");
  if (!isSoftphoneChannel(channel) || context !== "from-internal") return;

  const uniqueid = get(evt, "uniqueid");
  const number = get(evt, "exten");
  const call = {
    uniqueid,
    direction: "outbound",
    number,
    status: "dialing",
    recording: `${uniqueid}.wav`, // matches MixMonitor(${UNIQUEID}.wav)
    started_at: new Date().toISOString(),
  };
  active.set(uniqueid, { ...call, answeredAt: null });
  persistAndPush(call);
}

// The far end is being rung.
function onDialBegin(evt) {
  const uniqueid = get(evt, "uniqueid");
  const call = active.get(uniqueid);
  if (!call) return;
  call.status = "ringing";
  persistAndPush({ uniqueid, status: "ringing", number: call.number });
}

// Channel went "Up" = answered.
function onNewstate(evt) {
  const channel = get(evt, "channel") || "";
  if (!isSoftphoneChannel(channel)) return;
  const state = get(evt, "channelstatedesc");
  const uniqueid = get(evt, "uniqueid");
  const call = active.get(uniqueid);
  if (!call) return;

  if (state === "Up" && !call.answeredAt) {
    call.answeredAt = Date.now();
    call.status = "answered";
    persistAndPush({
      uniqueid,
      status: "answered",
      number: call.number,
      answered_at: new Date(call.answeredAt).toISOString(),
    });
  } else if (state === "Ringing" && call.status === "dialing") {
    call.status = "ringing";
    persistAndPush({ uniqueid, status: "ringing", number: call.number });
  }
}

// Channel torn down = call ended. Compute talk duration and finalize.
function onHangup(evt) {
  const channel = get(evt, "channel") || "";
  if (!isSoftphoneChannel(channel)) return;
  const uniqueid = get(evt, "uniqueid");
  const call = active.get(uniqueid);
  if (!call) return;

  const endedAt = Date.now();
  const duration = call.answeredAt
    ? Math.round((endedAt - call.answeredAt) / 1000)
    : 0;
  const finalStatus = call.answeredAt ? "ended" : "no-answer";

  persistAndPush({
    uniqueid,
    status: finalStatus,
    number: call.number,
    recording: call.answeredAt ? `${uniqueid}.wav` : null,
    ended_at: new Date(endedAt).toISOString(),
    duration,
  });
  active.delete(uniqueid);
}
