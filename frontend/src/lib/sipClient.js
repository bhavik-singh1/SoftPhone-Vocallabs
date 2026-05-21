import {
  UserAgent,
  Registerer,
  Inviter,
  Invitation,
  SessionState,
  RegistererState,
} from "sip.js";

// Thin wrapper over SIP.js: register over WSS, place/receive calls, and expose
// mute / hold / DTMF. Audio is local (true WebRTC softphone). Both directions:
//   - outbound: call() builds an Inviter (dashboard → PSTN trunk).
//   - inbound:  the UA delegate's onInvite fires when the carrier dials our DID
//               (Asterisk rings the browser); answer()/hangup() control it.
export class SipPhone {
  constructor(sipConfig, callbacks = {}) {
    this.cfg = sipConfig;
    // { onRegistered, onUnregistered, onSessionState, onIncoming }
    this.cb = callbacks;
    this.ua = null;
    this.registerer = null;
    this.session = null;
    this._reconnectTimer = null;
    this.remoteAudio = document.getElementById("remote-audio");
  }

  async start() {
    const uri = UserAgent.makeURI(this.cfg.sipUri);
    this.ua = new UserAgent({
      uri,
      displayName: this.cfg.displayName,
      authorizationUsername: this.cfg.authorizationUser,
      authorizationPassword: this.cfg.password,
      transportOptions: { server: this.cfg.wsServer },
      delegate: {
        // Inbound call: carrier dialed our DID → Asterisk is ringing the browser.
        onInvite: (invitation) => this._onIncoming(invitation),
        // Mobile networks drop the WebSocket often. On every (re)connect, refresh
        // the SIP registration so our contact always points at the LIVE socket.
        // A stale contact (old/dead connection) is exactly what makes an inbound
        // call fail with "server error" until a restart forces a fresh connect.
        onConnect: () => {
          this.registerer?.register().catch(() => {});
        },
        // WebSocket dropped → mark unregistered and reconnect (which re-registers
        // via onConnect above). Debounced so we don't hammer a downed server.
        onDisconnect: (error) => {
          this.cb.onUnregistered?.();
          if (error) {
            clearTimeout(this._reconnectTimer);
            this._reconnectTimer = setTimeout(() => {
              this.ua?.reconnect().catch(() => {});
            }, 3000);
          }
        },
      },
      sessionDescriptionHandlerFactoryOptions: {
        // Cap ICE gathering at 1.5s so we answer/connect as soon as the fast
        // direct (STUN srflx, ~300ms) candidate is ready, instead of WAITING on
        // the slow (US) TURN-relay allocation to finish. That wait was the 4-5s
        // delay before the call actually connected to the caller.
        iceGatheringTimeout: 1500,
        peerConnectionConfiguration: {
          // Prepend a fast public STUN so the browser gathers its reflexive
          // candidate quickly (the metered STUN was slow). With "all", a DIRECT
          // srflx<->srflx pair connects in well under a second; the (distant)
          // TURN relay is only a fallback. Relay-only was forcing EVERY call
          // through that relay → the 4-5s delay before audio. ICE's
          // bidirectional checks won't nominate a one-way pair, so this is both
          // faster and safe (the old one-way issue was carrier-side, not here).
          iceServers: [
            { urls: "stun:stun.l.google.com:19302" },
            ...(this.cfg.iceServers || []),
          ],
          iceTransportPolicy: "all",
        },
      },
    });

    await this.ua.start();

    this.registerer = new Registerer(this.ua);
    this.registerer.stateChange.addListener((state) => {
      if (state === RegistererState.Registered) this.cb.onRegistered?.();
      if (state === RegistererState.Unregistered) this.cb.onUnregistered?.();
    });
    await this.registerer.register();
  }

  async call(number) {
    if (!this.ua) throw new Error("UA not started");
    const target = UserAgent.makeURI(
      `sip:${number}@${this.cfg.sipUri.split("@")[1]}`
    );
    const inviter = new Inviter(this.ua, target, {
      sessionDescriptionHandlerOptions: {
        constraints: { audio: true, video: false },
      },
    });
    this.session = inviter;
    this._wireSession(inviter, number);
    await inviter.invite();
    return inviter;
  }

  // --- Inbound ---
  _onIncoming(invitation) {
    // One call at a time: if already busy, reject with 486 Busy Here.
    if (this.session) {
      invitation.reject({ statusCode: 486 });
      return;
    }
    this.session = invitation;
    const number = invitation.remoteIdentity?.uri?.user || "Unknown";
    this._wireSession(invitation, number);
    this.cb.onIncoming?.(number);
  }

  // Answer a ringing inbound call (mic prompt happens here).
  async answer() {
    if (!(this.session instanceof Invitation)) return;
    await this.session.accept({
      sessionDescriptionHandlerOptions: {
        constraints: { audio: true, video: false },
      },
    });
  }

  _wireSession(session, number) {
    session.stateChange.addListener((state) => {
      this.cb.onSessionState?.(state, number);
      if (state === SessionState.Established) this._attachRemoteAudio(session);
      if (state === SessionState.Terminated) {
        if (this.remoteAudio) this.remoteAudio.srcObject = null;
        this.session = null;
      }
    });
  }

  _attachRemoteAudio(session) {
    const pc = session.sessionDescriptionHandler?.peerConnection;
    if (!pc) return;
    const stream = new MediaStream();
    pc.getReceivers().forEach((r) => r.track && stream.addTrack(r.track));
    this.remoteAudio.srcObject = stream;
    this.remoteAudio.play().catch(() => {});
  }

  // Ends/cancels/declines whatever the current session is, based on its state.
  // The BYE must leave the browser the INSTANT the user hangs up. The earlier
  // ~15-20s "mobile won't disconnect" bug was SIP.js DEFERRING the BYE: calling
  // bye() while the session is still Establishing (accept() in flight, or the
  // dialog's confirming ACK not yet settled) makes SIP.js queue the BYE until
  // the session reaches a terminal-eligible state — so the carrier leg lingered
  // until a timeout. We now drop the local session reference immediately and
  // dispatch the right teardown for the EXACT state, retrying once a tick later
  // for the in-flight-accept case so the BYE goes out as soon as it's legal.
  hangup() {
    if (!this.session) return;
    const s = this.session;
    // Detach our reference up front so a late state-change can't re-enter here.
    this.session = null;
    if (this.remoteAudio) this.remoteAudio.srcObject = null;
    this._endSession(s);
  }

  _endSession(s, retried = false) {
    switch (s.state) {
      case SessionState.Initial:
        // Inbound not-yet-answered → reject (4xx); outbound not-yet-sent → cancel.
        if (s instanceof Invitation) s.reject?.().catch(() => {});
        else s.cancel?.().catch(() => {});
        break;
      case SessionState.Establishing:
        // Outbound still ringing → CANCEL. Inbound mid-accept (we already sent
        // 200) → the dialog isn't confirmed, so bye() would queue; wait one tick
        // for the ACK, then BYE. This is the path that caused the long delay.
        if (s instanceof Invitation) {
          if (!retried) setTimeout(() => this._endSession(s, true), 0);
          else s.bye?.().catch(() => {});
        } else {
          s.cancel?.().catch(() => {});
        }
        break;
      case SessionState.Established:
        s.bye?.().catch(() => {});
        break;
      default:
        break;
    }
  }

  // Mute/unmute the local mic by toggling the outgoing audio track.
  setMuted(muted) {
    const pc = this.session?.sessionDescriptionHandler?.peerConnection;
    if (!pc) return;
    pc.getSenders().forEach((sender) => {
      if (sender.track && sender.track.kind === "audio") {
        sender.track.enabled = !muted;
      }
    });
  }

  sendDtmf(tone) {
    const sdh = this.session?.sessionDescriptionHandler;
    if (sdh?.sendDtmf) sdh.sendDtmf(tone);
  }

  // "Speaker" toggle: full volume (loudspeaker) vs reduced (earpiece-like).
  setSpeaker(on) {
    if (this.remoteAudio) this.remoteAudio.volume = on ? 1.0 : 0.45;
  }

  async stop() {
    try {
      await this.registerer?.unregister();
    } catch {}
    try {
      await this.ua?.stop();
    } catch {}
  }
}
