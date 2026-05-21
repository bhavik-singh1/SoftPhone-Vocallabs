import React, { useEffect, useState, useCallback } from "react";
import { api } from "../api.js";
import {
  PhoneIncomingIcon, PhoneOutgoingIcon, PhoneMissedIcon, PhoneIcon,
  PlayIcon, ClockIcon, ChevronLeftIcon, ChevronRightIcon,
} from "./icons.jsx";

// Numbers we can't dial back (inbound with no caller-id, internal extens).
const isDialable = (n) => !!n && /^\+?[0-9]{3,}$/.test(n.replace(/\s/g, ""));

const PAGE_SIZE = 15;

function fmtDuration(sec) {
  if (!sec) return null;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m ? `${m}m ${s}s` : `${s}s`;
}

function fmtTime(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (sameDay) return `Today, ${time}`;
  return `${d.toLocaleDateString([], { day: "numeric", month: "short" })}, ${time}`;
}

// `reloadKey` bumps when a call ends so we refetch the current page.
// `onCall` redials a number from a history row.
export default function CallHistory({ reloadKey, onCall }) {
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ items: [], total: 0 });
  const [audioUrl, setAudioUrl] = useState(null);
  const [playingId, setPlayingId] = useState(null);

  const load = useCallback(async (p) => {
    try {
      const res = await api.calls(p, PAGE_SIZE);
      setData({ items: res.items, total: res.total });
    } catch {
      setData({ items: [], total: 0 });
    }
  }, []);

  useEffect(() => { load(page); }, [page, load]);
  // A new call ended → jump back to page 1 and refresh.
  useEffect(() => {
    if (reloadKey === 0) return;
    if (page === 1) load(1);
    else setPage(1);
  }, [reloadKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const play = async (uniqueid) => {
    try {
      const url = await api.recordingUrl(uniqueid);
      setAudioUrl(url);
      setPlayingId(uniqueid);
    } catch {
      setPlayingId(null);
      setAudioUrl(null);
    }
  };

  const { items, total } = data;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);

  return (
    <section className="panel">
      <div className="panel-head">
        <div className="panel-title">
          Call history{total > 0 && <span className="sub">{total} total</span>}
        </div>
      </div>

      {items.length === 0 ? (
        <div className="history-empty">
          <span className="empty-ico"><ClockIcon size={24} /></span>
          <div>No calls yet — your history will appear here.</div>
        </div>
      ) : (
        <>
          <div className="history-list">
            {items.map((c) => (
              <CallRow
                key={c.id}
                call={c}
                playing={playingId === c.uniqueid}
                onPlay={play}
                onCall={onCall}
              />
            ))}
          </div>

          {audioUrl && (
            <div className="player-wrap">
              <audio src={audioUrl} controls autoPlay onEnded={() => setPlayingId(null)} />
            </div>
          )}

          <div className="pager">
            <span className="range">{from}–{to} of {total}</span>
            <div className="pager-btns">
              <button
                className="pager-btn"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                title="Previous"
              >
                <ChevronLeftIcon size={16} />
              </button>
              <button
                className="pager-btn"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                title="Next"
              >
                <ChevronRightIcon size={16} />
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

function CallRow({ call: c, playing, onPlay, onCall }) {
  const missed = c.status === "no-answer" || c.status === "failed";
  const inbound = c.direction === "inbound";
  const dirClass = missed ? "missed" : inbound ? "inbound" : "outbound";
  const Icon = missed ? PhoneMissedIcon : inbound ? PhoneIncomingIcon : PhoneOutgoingIcon;
  const dur = fmtDuration(c.duration);
  const dialable = isDialable(c.number);
  const hasRec = c.recording && c.status === "ended";

  return (
    <div className="call-row">
      <span className={`call-dir ${dirClass}`}><Icon size={18} /></span>
      <div className="call-meta">
        <div className="call-num">{c.number || "Unknown"}</div>
        <div className="call-sub">
          <span>{fmtTime(c.started_at)}</span>
          {dur && <><span className="sep">·</span><span>{dur}</span></>}
          {c.status === "no-answer" && <span className="tag noans">Missed</span>}
          {c.status === "failed" && <span className="tag missed">Failed</span>}
        </div>
      </div>
      <div className="row-actions">
        {hasRec && (
          <button
            className={`row-icon ${playing ? "active" : ""}`}
            onClick={() => onPlay(c.uniqueid)}
            title={playing ? "Playing recording" : "Play recording"}
          >
            <PlayIcon size={15} />
          </button>
        )}
        {dialable && (
          <button
            className="row-icon call"
            onClick={() => onCall?.(c.number)}
            title={`Call ${c.number}`}
          >
            <PhoneIcon size={15} />
          </button>
        )}
      </div>
    </div>
  );
}
