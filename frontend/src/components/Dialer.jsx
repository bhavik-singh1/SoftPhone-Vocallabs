import React, { useState, useEffect, useCallback } from "react";

// iPhone-style keypad: digit + letters beneath.
const KEYS = [
  { d: "1", s: "" },
  { d: "2", s: "ABC" },
  { d: "3", s: "DEF" },
  { d: "4", s: "GHI" },
  { d: "5", s: "JKL" },
  { d: "6", s: "MNO" },
  { d: "7", s: "PQRS" },
  { d: "8", s: "TUV" },
  { d: "9", s: "WXYZ" },
  { d: "*", s: "" },
  { d: "0", s: "+" },
  { d: "#", s: "" },
];

export default function Dialer({ onDial, disabled }) {
  const [number, setNumber] = useState("");

  const press = (k) => setNumber((n) => (n.length < 18 ? n + k : n));
  const back = () => setNumber((n) => n.slice(0, -1));
  const call = useCallback(() => {
    setNumber((n) => {
      if (n.trim()) onDial(n.trim());
      return n;
    });
  }, [onDial]);

  // Physical keyboard support (numpad + main row): digits, * # +, Backspace, Enter.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key >= "0" && e.key <= "9") press(e.key);
      else if (e.key === "*" || e.key === "#" || e.key === "+") press(e.key);
      else if (e.key === "Backspace") { e.preventDefault(); back(); }
      else if (e.key === "Enter") { e.preventDefault(); call(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [call]);

  return (
    <div className="phone-screen dialer-screen">
      <div className="num-row">
        <div className={`num-display ${number ? "" : "placeholder"}`}>
          {number || "Enter number"}
        </div>
      </div>

      <div className="keypad">
        {KEYS.map((k) => (
          <button key={k.d} className="key" onClick={() => press(k.d)}>
            <span className="kd">{k.d}</span>
            {k.s && <span className="ks">{k.s}</span>}
          </button>
        ))}
      </div>

      <div className="dial-row">
        <div className="dial-spacer" />
        <button
          className="call-fab"
          onClick={call}
          disabled={disabled || !number.trim()}
          title={disabled ? "Registering…" : "Call"}
        >
          <CallIcon />
        </button>
        <div className="dial-spacer">
          {number && (
            <button className="back-key" onClick={back} title="Delete">
              ⌫
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function CallIcon() {
  return (
    <svg viewBox="0 0 24 24" width="30" height="30" fill="white">
      <path d="M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z" />
    </svg>
  );
}
