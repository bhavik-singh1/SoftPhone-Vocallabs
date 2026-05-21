import React, { useState, useEffect, useCallback } from "react";
import { PhoneIcon, DeleteIcon } from "./icons.jsx";

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

  // Physical keyboard: digits + * # +, Backspace, Enter.
  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === "INPUT") return;
      if (e.key >= "0" && e.key <= "9") press(e.key);
      else if (e.key === "*" || e.key === "#" || e.key === "+") press(e.key);
      else if (e.key === "Backspace") { e.preventDefault(); back(); }
      else if (e.key === "Enter") { e.preventDefault(); call(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [call]);

  return (
    <div className="phone-stage">
      <div className={`num-display ${number ? "" : "empty"}`}>
        {number || "Enter a number"}
      </div>
      <div className="num-caption">
        {number ? "Press call or hit Enter" : "Use the keypad or your keyboard"}
      </div>

      <div className="keypad">
        {KEYS.map((k) => (
          <button key={k.d} className="key" onClick={() => press(k.d)} type="button">
            <span className="kd">{k.d}</span>
            {k.s && <span className="ks">{k.s}</span>}
          </button>
        ))}
      </div>

      <div className="dial-row">
        <div className="dial-side" />
        <button
          className="fab call"
          onClick={call}
          disabled={disabled || !number.trim()}
          title={disabled ? "Connecting…" : "Call"}
          type="button"
        >
          <PhoneIcon size={26} />
        </button>
        <div className="dial-side right">
          {number && (
            <button className="back-key" onClick={back} title="Delete" type="button">
              <DeleteIcon size={22} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
