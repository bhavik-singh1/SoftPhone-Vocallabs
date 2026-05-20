import {
  UserAgent,
  Registerer,
  Inviter,
  SessionState,
  RegistererState,
} from "sip.js";

// Thin wrapper over SIP.js: register over WSS, place/hang up outbound calls,
// and expose mute / hold / DTMF. Audio is local (true WebRTC softphone).
export class SipPhone {
  constructor(sipConfig, callbacks = {}) {
    this.cfg = sipConfig;
    this.cb = callbacks; // { onRegistered, onUnregistered, onSessionState }
    this.ua = null;
    this.registerer = null;
    this.session = null;
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
      sessionDescriptionHandlerFactoryOptions: {
        peerConnectionConfiguration: { iceServers: this.cfg.iceServers },
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

  hangup() {
    if (!this.session) return;
    const s = this.session;
    switch (s.state) {
      case SessionState.Initial:
      case SessionState.Establishing:
        s.cancel?.();
        break;
      case SessionState.Established:
        s.bye?.();
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
