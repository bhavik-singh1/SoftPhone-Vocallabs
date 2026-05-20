import React, { useState } from "react";
import { api } from "../api.js";

function fmtDuration(sec) {
  if (!sec) return "0s";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m ? `${m}m ${s}s` : `${s}s`;
}

function fmtTime(ts) {
  if (!ts) return "";
  return new Date(ts).toLocaleString();
}

const STATUS_ICON = {
  ended: "✅",
  answered: "🟢",
  "no-answer": "🔕",
  failed: "⚠️",
  dialing: "📤",
  ringing: "🔔",
};

export default function CallHistory({ history }) {
  const [audioUrl, setAudioUrl] = useState(null);
  const [playingId, setPlayingId] = useState(null);

  const play = async (uniqueid) => {
    try {
      const url = await api.recordingUrl(uniqueid);
      setAudioUrl(url);
      setPlayingId(uniqueid);
    } catch {
      alert("Recording not available yet.");
    }
  };

  return (
    <div className="history card">
      <h3>Call history</h3>
      {history.length === 0 && <p className="muted">No calls yet.</p>}
      <ul className="call-list">
        {history.map((c) => (
          <li key={c.id} className="call-row">
            <span className="ci">{STATUS_ICON[c.status] || "•"}</span>
            <div className="cmeta">
              <div className="cnum">{c.number || "—"}</div>
              <div className="csub muted">
                {fmtTime(c.started_at)} · {fmtDuration(c.duration)}
              </div>
            </div>
            {c.recording && c.status === "ended" && (
              <button className="link" onClick={() => play(c.uniqueid)}>
                {playingId === c.uniqueid ? "▶ Playing" : "▶ Recording"}
              </button>
            )}
          </li>
        ))}
      </ul>
      {audioUrl && (
        <audio className="player" src={audioUrl} controls autoPlay />
      )}
    </div>
  );
}
