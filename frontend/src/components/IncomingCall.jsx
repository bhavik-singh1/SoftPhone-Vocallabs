import React, { useEffect } from "react";

// A simple WebAudio ringtone so an inbound call is audible without shipping an
// audio asset: a soft two-tone burst repeated while this screen is mounted.
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
      gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + dur);
    };
    const cycle = () => {
      if (stopped) return;
      beep(480, 0, 0.4);
      beep(620, 0.45, 0.4);
      timers.push(setTimeout(cycle, 2000)); // ring every 2s
    };
    cycle();
    return () => {
      stopped = true;
      timers.forEach(clearTimeout);
      ctx.close?.();
    };
  }, []);
}

export default function IncomingCall({ number, onAccept, onDecline }) {
  useRingtone();

  // Keyboard: Enter answers, Esc declines.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Enter") onAccept();
      else if (e.key === "Escape") onDecline();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onAccept, onDecline]);

  return (
    <div className="phone-screen incall-screen incoming">
      <div className="incall-top">
        <div className="avatar ringing">{(number || "?").slice(-2)}</div>
        <div className="callee">{number || "Unknown"}</div>
        <div className="call-status">Incoming call…</div>
      </div>

      <div className="incoming-actions">
        <button className="ic-action decline" onClick={onDecline}>
          <span className="ic-fab hangup-fab"><EndIcon /></span>
          <span className="ic-label">Decline</span>
        </button>
        <button className="ic-action accept" onClick={onAccept}>
          <span className="ic-fab answer-fab"><PhoneIcon /></span>
          <span className="ic-label">Accept</span>
        </button>
      </div>
    </div>
  );
}

function PhoneIcon() {
  return (
    <svg viewBox="0 0 24 24" width="30" height="30" fill="white">
      <path d="M6.62 10.79c1.44 2.83 3.76 5.15 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.18z" />
    </svg>
  );
}

function EndIcon() {
  return (
    <svg viewBox="0 0 24 24" width="30" height="30" fill="white">
      <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08c-.18-.17-.29-.42-.29-.7 0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.7l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.1-.7-.28-.79-.73-1.69-1.36-2.67-1.85-.33-.16-.56-.51-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z" />
    </svg>
  );
}
