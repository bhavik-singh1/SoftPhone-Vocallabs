import React, { useEffect, useState, useCallback } from "react";
import {
  MicIcon, MicOffIcon, GridIcon, VolumeIcon, VolumeLowIcon, PhoneOffIcon,
} from "./icons.jsx";

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

  // Keyboard: digits send DTMF; Esc hangs up.
  const dtmf = useCallback((t) => onDtmf(t), [onDtmf]);
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === "INPUT") return;
      if (/^[0-9*#]$/.test(e.key)) dtmf(e.key);
      else if (e.key === "Escape") onHangup();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dtmf, onHangup]);

  const statusText =
    call.status === "answered" ? timer : STATUS_LABEL[call.status] || call.status;
  const ringing = call.status !== "answered";

  return (
    <div className="phone-stage incall">
      <div className="incall-head">
        <div className={`avatar-lg ${ringing ? "pulse" : ""}`}>
          {(call.number || "?").slice(-2)}
        </div>
        <div className="incall-name">{call.number || "Unknown"}</div>
        <div className="incall-status">{statusText}</div>
      </div>

      {showDtmf ? (
        <div className="keypad" style={{ marginTop: 30 }}>
          {DTMF.map((k) => (
            <button key={k} className="key" onClick={() => onDtmf(k)} type="button">
              <span className="kd">{k}</span>
            </button>
          ))}
        </div>
      ) : (
        <div className="incall-controls">
          <Ctrl active={call.muted} onClick={onMute} label={call.muted ? "Unmute" : "Mute"}>
            {call.muted ? <MicOffIcon size={22} /> : <MicIcon size={22} />}
          </Ctrl>
          <Ctrl active={showDtmf} onClick={() => setShowDtmf(true)} label="Keypad">
            <GridIcon size={22} />
          </Ctrl>
          <Ctrl active={speaker} onClick={toggleSpeaker} label="Speaker">
            {speaker ? <VolumeIcon size={22} /> : <VolumeLowIcon size={22} />}
          </Ctrl>
        </div>
      )}

      <div className="incall-end">
        {showDtmf && (
          <button className="back-key" onClick={() => setShowDtmf(false)} style={{ marginRight: 18 }}>
            <GridIcon size={22} />
          </button>
        )}
        <button className="fab end" onClick={onHangup} title="End call" type="button">
          <PhoneOffIcon size={26} />
        </button>
      </div>
    </div>
  );
}

function Ctrl({ children, label, onClick, active }) {
  return (
    <button className={`ctrl ${active ? "active" : ""}`} onClick={onClick} type="button">
      <span className="ctrl-ico">{children}</span>
      <span className="ctrl-label">{label}</span>
    </button>
  );
}
