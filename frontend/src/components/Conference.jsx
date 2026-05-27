import React, { useState, useEffect } from "react";
import {
  PhoneIcon, PhoneOffIcon, PhoneOutgoingIcon, ClockIcon,
} from "./icons.jsx";

// Per-leg status label + dot color.
const LEG_LABEL = {
  ringing: "Ringing…",
  answered: "Answered",
  in: "In call",
  "no-answer": "No answer",
  failed: "Failed",
  ended: "Left",
};
const LEG_CLASS = {
  ringing: "amber",
  answered: "green",
  in: "green",
  "no-answer": "muted",
  failed: "red",
  ended: "muted",
};

function useTimer(startedAt) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!startedAt) return;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [startedAt]);
  if (!startedAt) return "";
  const s = Math.floor((Date.now() - startedAt) / 1000);
  const mm = String(Math.floor(s / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

// The entry form (two numbers) shown before a conference starts.
export function MultiCallForm({ onStart, disabled }) {
  const [a, setA] = useState("");
  const [b, setB] = useState("");
  const valid = a.trim() || b.trim();
  return (
    <div className="phone-stage">
      <div className="multi-head">
        <div className="multi-title">Call two numbers</div>
        <div className="multi-sub">Both ring at once — talk to whoever answers</div>
      </div>
      <div className="multi-fields">
        <label className="field">
          <span>First number</span>
          <input
            value={a}
            onChange={(e) => setA(e.target.value)}
            placeholder="+91…"
            inputMode="tel"
          />
        </label>
        <label className="field">
          <span>Second number</span>
          <input
            value={b}
            onChange={(e) => setB(e.target.value)}
            placeholder="+91…"
            inputMode="tel"
          />
        </label>
      </div>
      <div className="multi-action">
        <button
          className="fab call"
          disabled={disabled || !valid}
          onClick={() => onStart(a.trim(), b.trim())}
          title={disabled ? "Connecting…" : "Call both"}
        >
          <PhoneIcon size={26} />
        </button>
      </div>
    </div>
  );
}

// The live conference screen: shows both legs' status and a hang-up.
export function ConferenceCall({ conf, onHangup }) {
  const timer = useTimer(conf.answeredAt);
  const legs = [
    { key: "phone_1", ...(conf.legs?.phone_1 || {}) },
    { key: "phone_2", ...(conf.legs?.phone_2 || {}) },
  ].filter((l) => l.number);

  const anyInCall = legs.some((l) => l.status === "in" || l.status === "answered");

  return (
    <div className="phone-stage incall">
      <div className="incall-head">
        <div className={`avatar-lg ${anyInCall ? "" : "pulse"}`}>
          <PhoneOutgoingIcon size={30} />
        </div>
        <div className="incall-name">Conference</div>
        <div className="incall-status">
          {anyInCall ? timer || "Connected" : "Calling both numbers…"}
        </div>
      </div>

      <div className="conf-legs">
        {legs.map((l) => (
          <div className="conf-leg" key={l.key}>
            <span className={`leg-dot ${LEG_CLASS[l.status] || "muted"}`} />
            <span className="leg-num">{l.number}</span>
            <span className={`leg-status ${LEG_CLASS[l.status] || "muted"}`}>
              {LEG_LABEL[l.status] || l.status}
            </span>
          </div>
        ))}
        {legs.length === 1 && (
          <div className="conf-hint">
            <ClockIcon size={13} /> Waiting for the other number…
          </div>
        )}
      </div>

      <div className="incall-end">
        <button className="fab end" onClick={onHangup} title="End conference">
          <PhoneOffIcon size={26} />
        </button>
      </div>
    </div>
  );
}
