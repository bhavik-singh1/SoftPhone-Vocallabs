import React, { useEffect } from "react";
import { PhoneIncomingIcon, PhoneIcon, PhoneOffIcon } from "./icons.jsx";

// A soft WebAudio ringtone so an inbound call is audible without shipping an
// audio asset: a gentle two-tone burst repeated while this popup is mounted.
function useRingtone() {
  useEffect(() => {
    let ctx;
    let stopped = false;
    const timers = [];
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch {
      return;
    }
    const beep = (freq, start, dur) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      osc.type = "sine";
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + start);
      gain.gain.exponentialRampToValueAtTime(0.22, ctx.currentTime + start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + dur);
    };
    const cycle = () => {
      if (stopped) return;
      beep(480, 0, 0.4);
      beep(620, 0.45, 0.4);
      timers.push(setTimeout(cycle, 2000));
    };
    cycle();
    return () => {
      stopped = true;
      timers.forEach(clearTimeout);
      ctx.close?.();
    };
  }, []);
}

// Android-style heads-up popup: small card pinned top-right, NOT a full screen.
export default function IncomingCall({ number, onAccept, onDecline }) {
  useRingtone();

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Enter") onAccept();
      else if (e.key === "Escape") onDecline();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onAccept, onDecline]);

  return (
    <div className="incoming-toast" role="dialog" aria-label="Incoming call">
      <div className="toast-row">
        <div className="toast-avatar"><PhoneIncomingIcon size={22} /></div>
        <div className="toast-meta">
          <div className="toast-label">Incoming call</div>
          <div className="toast-num">{number || "Unknown"}</div>
        </div>
      </div>
      <div className="toast-actions">
        <button className="toast-btn decline" onClick={onDecline} type="button">
          <PhoneOffIcon size={17} /> Decline
        </button>
        <button className="toast-btn accept" onClick={onAccept} type="button">
          <PhoneIcon size={17} /> Accept
        </button>
      </div>
    </div>
  );
}
