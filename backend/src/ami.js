import AsteriskManager from "asterisk-manager";
import { config } from "./config.js";
import { upsertCall } from "./db.js";
import { broadcast } from "./ws.js";
import { takeOutboundOwner, inboundOwner } from "./ownership.js";

// In-memory state for calls currently in progress, keyed by Uniqueid. CDRs are
// persisted to Postgres on changes and pushed live to the owning user's browser.
const active = new Map();

// The softphone channel looks like "PJSIP/webrtc-00000001".
const SOFTPHONE_PREFIX = `PJSIP/${config.sip.user}-`;

// asterisk-manager lowercases event keys, but read defensively anyway.
const get = (evt, key) => evt[key] ?? evt[key.toLowerCase()] ?? evt[key.toUpperCase()];

function isSoftphoneChannel(channel = "") {
  return channel.startsWith(SOFTPHONE_PREFIX);
}

async function persistAndPush(call) {
  console.log(
    `[ami] call ${call.uniqueid} -> ${call.status}` +
      `${call.number ? " (" + call.number + ")" : ""}` +
      `${call.owner ? " @" + call.owner : ""}`
  );
  try {
    await upsertCall(call);
  } catch (err) {
    console.warn(`[ami] upsert failed: ${err.message}`);
  }
  // Tell the owner's browser (broadcast filters by owner when present).
  const owner = call.owner || active.get(call.uniqueid)?.owner;
  broadcast({ ...call, owner });
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
    switch (get(evt, "event")) {
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

// New channel. Two cases we record:
//   * OUTBOUND: a softphone channel in from-internal = the user dialed out.
//   * INBOUND:  a trunk channel in from-trunk = the carrier called our DID.
function onNewchannel(evt) {
  const channel = get(evt, "channel") || "";
  const context = get(evt, "context");
  const uniqueid = get(evt, "uniqueid");

  if (isSoftphoneChannel(channel) && context === "from-internal") {
    const number = get(evt, "exten");
    const owner = takeOutboundOwner(number);
    const call = {
      uniqueid,
      owner,
      direction: "outbound",
      number,
      status: "dialing",
      recording: `${uniqueid}.wav`,
      started_at: new Date().toISOString(),
    };
    active.set(uniqueid, { ...call, answeredAt: null });
    persistAndPush(call);
    return;
  }

  if (context === "from-trunk") {
    // Inbound: the caller's number rides in on CallerIDNum.
    const number = get(evt, "calleridnum") || get(evt, "exten");
    const owner = inboundOwner();
    const call = {
      uniqueid,
      owner,
      direction: "inbound",
      number,
      caller_id: number,
      status: "ringing",
      recording: `${uniqueid}.wav`,
      started_at: new Date().toISOString(),
    };
    active.set(uniqueid, { ...call, answeredAt: null });
    persistAndPush(call);
    return;
  }
}

// The far end is being rung (outbound).
function onDialBegin(evt) {
  const uniqueid = get(evt, "uniqueid");
  const call = active.get(uniqueid);
  if (!call || call.direction !== "outbound") return;
  call.status = "ringing";
  persistAndPush({ uniqueid, status: "ringing", number: call.number });
}

// Channel went "Up" = answered.
function onNewstate(evt) {
  const channel = get(evt, "channel") || "";
  const uniqueid = get(evt, "uniqueid");
  const call = active.get(uniqueid);
  if (!call) return;

  // For outbound we watch the softphone channel; for inbound the trunk channel
  // (whose uniqueid we stored) going Up means the agent answered.
  const state = get(evt, "channelstatedesc");
  if (state === "Up" && !call.answeredAt) {
    call.answeredAt = Date.now();
    call.status = "answered";
    persistAndPush({
      uniqueid,
      status: "answered",
      number: call.number,
      answered_at: new Date(call.answeredAt).toISOString(),
    });
  } else if (
    state === "Ringing" &&
    call.direction === "outbound" &&
    call.status === "dialing"
  ) {
    call.status = "ringing";
    persistAndPush({ uniqueid, status: "ringing", number: call.number });
  }
}

// Channel torn down = call ended. Compute talk duration and finalize.
function onHangup(evt) {
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
