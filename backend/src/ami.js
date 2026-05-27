import AsteriskManager from "asterisk-manager";
import { config } from "./config.js";
import { upsertCall } from "./db.js";
import { broadcast } from "./ws.js";
import { takeOutboundOwner, inboundOwner } from "./ownership.js";

// The connected AMI instance, shared so the conference module can send
// Originate/Hangup actions (set in startAmi()).
let amiInstance = null;
export const getAmi = () => amiInstance;

// One CDR per call. Calls are keyed by Linkedid — Asterisk's per-call group id
// that ALL legs of a call share. This is what collapses the carrier's forked
// inbound legs (it rings the DID on two trunk endpoints at once) into a single
// history row instead of several "missed" duplicates.
const active = new Map(); // linkedid -> { uniqueid, owner, direction, number, status, answeredAt }

// The softphone channel looks like "PJSIP/webrtc-00000001".
const SOFTPHONE_PREFIX = `PJSIP/${config.sip.user}-`;
const isSoftphone = (ch = "") => ch.startsWith(SOFTPHONE_PREFIX);
const isTrunk = (ch = "") => ch.startsWith("PJSIP/trunk");

// asterisk-manager lowercases event keys, but read defensively anyway.
const get = (evt, key) => evt[key] ?? evt[key.toLowerCase()] ?? evt[key.toUpperCase()];

async function persistAndPush(call) {
  console.log(
    `[ami] ${call.direction || ""} ${call.uniqueid} -> ${call.status}` +
      `${call.number ? " (" + call.number + ")" : ""}` +
      `${call.owner ? " @" + call.owner : ""}`
  );
  try {
    await upsertCall(call);
  } catch (err) {
    console.warn(`[ami] upsert failed: ${err.message}`);
  }
  broadcast({ ...call });
}

export function startAmi() {
  const ami = AsteriskManager(
    config.ami.port,
    config.ami.host,
    config.ami.user,
    config.ami.password,
    true
  );
  ami.keepConnected();
  amiInstance = ami;

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

// OUTBOUND only: a softphone channel created in from-internal = the user dialed.
// (Inbound is detected at DialBegin instead, so forked trunk legs don't each
// create a row.)
function onNewchannel(evt) {
  const channel = get(evt, "channel") || "";
  const context = get(evt, "context");
  if (!isSoftphone(channel) || context !== "from-internal") return;

  const linkedid = get(evt, "linkedid") || get(evt, "uniqueid");
  if (active.has(linkedid)) return;

  const uniqueid = get(evt, "uniqueid");
  const number = get(evt, "exten");
  const owner = takeOutboundOwner(number);
  const call = {
    uniqueid, owner, direction: "outbound", number,
    status: "dialing", recording: `${uniqueid}.wav`,
    started_at: new Date().toISOString(),
  };
  active.set(linkedid, { ...call, linkedid, answeredAt: null });
  persistAndPush(call);
}

// DialBegin tells us a channel is dialing another. Two cases:
//   * OUTBOUND: dialing channel is the softphone → far end (trunk) is ringing.
//   * INBOUND:  a trunk channel is dialing the softphone → the browser is being
//     rung. Record ONE inbound row per call (keyed by linkedid; the duplicate
//     forked leg shares the linkedid, so it's ignored).
function onDialBegin(evt) {
  const channel = get(evt, "channel") || "";
  const dest = get(evt, "destchannel") || "";
  const linkedid = get(evt, "linkedid") || get(evt, "uniqueid");

  if (isTrunk(channel) && isSoftphone(dest)) {
    if (active.has(linkedid)) return; // forked duplicate — already tracked
    const number = get(evt, "calleridnum") || get(evt, "connectedlinenum") || "Unknown";
    const uniqueid = get(evt, "destuniqueid") || get(evt, "uniqueid");
    const owner = inboundOwner();
    const call = {
      uniqueid, owner, direction: "inbound", number, caller_id: number,
      status: "ringing", recording: `${uniqueid}.wav`,
      started_at: new Date().toISOString(),
    };
    active.set(linkedid, { ...call, linkedid, answeredAt: null });
    persistAndPush(call);
    return;
  }

  if (isSoftphone(channel)) {
    const call = active.get(linkedid);
    if (call && call.direction === "outbound" && call.status === "dialing") {
      call.status = "ringing";
      persistAndPush({ uniqueid: call.uniqueid, status: "ringing", number: call.number });
    }
  }
}

// A channel went "Up". For both directions the SOFTPHONE channel going Up means
// the conversation is connected (outbound: far end answered; inbound: agent
// answered). Matching on the softphone channel avoids a trunk Up firing first.
function onNewstate(evt) {
  const channel = get(evt, "channel") || "";
  if (!isSoftphone(channel)) return;
  const linkedid = get(evt, "linkedid") || get(evt, "uniqueid");
  const call = active.get(linkedid);
  if (!call) return;

  const state = get(evt, "channelstatedesc");
  if (state === "Up" && !call.answeredAt) {
    call.answeredAt = Date.now();
    call.status = "answered";
    persistAndPush({
      uniqueid: call.uniqueid, status: "answered", number: call.number,
      answered_at: new Date(call.answeredAt).toISOString(),
    });
  }
}

// The softphone channel torn down = the call ended for this user. We only
// finalize on the softphone leg so a forked trunk leg hanging up can't end the
// call early or create a spurious "missed".
function onHangup(evt) {
  const channel = get(evt, "channel") || "";
  const linkedid = get(evt, "linkedid") || get(evt, "uniqueid");
  const call = active.get(linkedid);
  if (!call) return;
  // Outbound is keyed by the softphone leg; inbound by the softphone DEST leg.
  // Only that leg's hangup finalizes the call.
  if (!isSoftphone(channel) && call.uniqueid !== get(evt, "uniqueid")) return;

  const endedAt = Date.now();
  const duration = call.answeredAt ? Math.round((endedAt - call.answeredAt) / 1000) : 0;
  const finalStatus = call.answeredAt ? "ended" : "no-answer";

  persistAndPush({
    uniqueid: call.uniqueid, status: finalStatus, number: call.number,
    recording: call.answeredAt ? `${call.uniqueid}.wav` : null,
    ended_at: new Date(endedAt).toISOString(), duration,
  });
  active.delete(linkedid);
}
