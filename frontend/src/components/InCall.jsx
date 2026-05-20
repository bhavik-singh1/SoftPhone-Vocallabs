import React, { useEffect, useState, useCallback } from "react";

const DTMF = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"];

const STATUS_LABEL = {
  connecting: "Calling…",
  dialing: "Calling…",
  ringing: "Ringing…",
  answered: "",
};

function useTimer(answeredAt) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!answeredAt) return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [answeredAt]);
  if (!answeredAt) return "";
  const s = Math.floor((Date.now() - answeredAt) / 1000);
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

export default function InCall({ call, onHangup, onMute, onDtmf, onSpeaker }) {
  const [showDtmf, setShowDtmf] = useState(false);
  const [speaker, setSpeaker] = useState(true);
  const timer = useTimer(call.answeredAt);

  const toggleSpeaker = () => {
    const next = !speaker;
    setSpeaker(next);
    onSpeaker?.(next);
  };

  // Keyboard: digits send DTMF during a call; Esc/Enter hangs up.
  const dtmf = useCallback((t) => onDtmf(t), [onDtmf]);
  useEffect(() => {
    const onKey = (e) => {
      if (/^[0-9*#]$/.test(e.key)) dtmf(e.key);
      else if (e.key === "Escape" || e.key === "Enter") onHangup();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dtmf, onHangup]);

  const statusText =
    call.status === "answered" ? timer : STATUS_LABEL[call.status] || call.status;

  return (
    <div className="phone-screen incall-screen">
      <div className="incall-top">
        <div className="avatar">{(call.number || "?").slice(-2)}</div>
        <div className="callee">{call.number}</div>
        <div className="call-status">{statusText}</div>
      </div>

      {showDtmf ? (
        <div className="keypad dtmf">
          {DTMF.map((k) => (
            <button key={k} className="key" onClick={() => onDtmf(k)}>
              <span className="kd">{k}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="incall-grid">
          <CtrlButton
            active={call.muted}
            onClick={onMute}
            icon={call.muted ? "🔇" : "🎙"}
            label="mute"
          />
          <CtrlButton
            active={showDtmf}
            onClick={() => setShowDtmf(true)}
            icon="⠿"
            label="keypad"
          />
          <CtrlButton
            active={speaker}
            onClick={toggleSpeaker}
            icon={speaker ? "🔊" : "🔉"}
            label="speaker"
          />
        </div>
      )}

      <div className="hangup-row">
        {showDtmf && (
          <button className="hide-dtmf" onClick={() => setShowDtmf(false)}>
            Hide
          </button>
        )}
        <button className="hangup-fab" onClick={onHangup} title="End call">
          <EndIcon />
        </button>
        <div className="dial-spacer" />
      </div>
    </div>
  );
}

function CtrlButton({ icon, label, onClick, active, disabled }) {
  return (
    <button
      className={`ctrl ${active ? "active" : ""}`}
      onClick={onClick}
      disabled={disabled}
    >
      <span className="ctrl-icon">{icon}</span>
      <span className="ctrl-label">{label}</span>
    </button>
  );
}

function EndIcon() {
  return (
    <svg viewBox="0 0 24 24" width="30" height="30" fill="white">
      <path d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08c-.18-.17-.29-.42-.29-.7 0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.7l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.1-.7-.28-.79-.73-1.69-1.36-2.67-1.85-.33-.16-.56-.51-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z" />
    </svg>
  );
}
