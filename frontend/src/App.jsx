import React, { useEffect, useRef, useState } from "react";
import { SessionState } from "sip.js";
import { api, getToken, clearToken, connectEvents } from "./api.js";
import { SipPhone } from "./lib/sipClient.js";
import { useStore } from "./store.js";
import Login from "./components/Login.jsx";
import Dialer from "./components/Dialer.jsx";
import InCall from "./components/InCall.jsx";
import IncomingCall from "./components/IncomingCall.jsx";
import CallHistory from "./components/CallHistory.jsx";
import { MultiCallForm, ConferenceCall } from "./components/Conference.jsx";
import {
  BrandMark, LogOutIcon, PhoneIncomingIcon, PhoneOutgoingIcon, PhoneIcon,
} from "./components/icons.jsx";

const USER_KEY = "sp_user";

export default function App() {
  const [loggedIn, setLoggedIn] = useState(!!getToken());
  const [mode, setMode] = useState("single"); // "single" | "multi"
  const phoneRef = useRef(null);
  const wsRef = useRef(null);
  // True while a conference is starting, so the browser leg the backend
  // originates is auto-answered instead of showing the incoming-call popup.
  const confStartingRef = useRef(false);

  const {
    registered, currentCall, incomingCall, username, historyVersion, numbers,
    conference, error,
    setRegistered, setUsername, setError, startCall, updateCall, endCall,
    setIncoming, clearIncoming, acceptIncoming, bumpHistory, setNumbers,
    startConferenceState, updateConference, endConferenceState,
  } = useStore();

  // Restore the display name across reloads.
  useEffect(() => {
    if (loggedIn && !username) setUsername(localStorage.getItem(USER_KEY) || "");
  }, [loggedIn, username, setUsername]);

  // Bring up the SIP client + live-event stream after login.
  useEffect(() => {
    if (!loggedIn) return;
    let cancelled = false;

    (async () => {
      try {
        const sipConfig = await api.sipConfig();
        setNumbers(sipConfig.numbers);
        const phone = new SipPhone(sipConfig, {
          onRegistered: () => setRegistered(true),
          onUnregistered: () => setRegistered(false),
          onIncoming: (number) => {
            // If we just started a conference, this INVITE is the backend
            // ringing our own leg into the room — auto-answer it (no popup).
            if (confStartingRef.current) {
              confStartingRef.current = false;
              phoneRef.current?.answer();
              return;
            }
            setIncoming(number);
          },
          onSessionState: (state) => {
            const st = useStore.getState();
            if (state === SessionState.Establishing && st.currentCall) {
              updateCall({ status: "dialing" });
            }
            if (state === SessionState.Established) {
              if (st.incomingCall && !st.currentCall) acceptIncoming();
              else if (st.currentCall && st.currentCall.status !== "answered") {
                updateCall({ status: "answered", answeredAt: Date.now() });
              }
            }
            if (state === SessionState.Terminated) {
              clearIncoming();
              endCall();
              bumpHistory();
            }
          },
        });
        if (cancelled) return;
        phoneRef.current = phone;
        await phone.start();

        wsRef.current = connectEvents((evt) => {
          // Live per-leg conference status (call-two-numbers feature).
          if (evt.kind === "conference") {
            updateConference(evt);
            if (evt.ended) bumpHistory();
            return;
          }
          if (evt.type !== "call") return;
          // Ignore single-call CDR noise while a conference is active (the
          // conference legs also generate call events).
          if (useStore.getState().conference) return;
          if (["dialing", "ringing", "answered"].includes(evt.status)) {
            updateCall({ status: evt.status });
          }
          if (["ended", "no-answer", "failed"].includes(evt.status)) {
            clearIncoming();
            endCall();
            phoneRef.current?.hangup();
            bumpHistory();
          }
        });
      } catch (e) {
        setError(e.message);
      }
    })();

    return () => {
      cancelled = true;
      wsRef.current?.close();
      phoneRef.current?.stop();
    };
  }, [loggedIn]);

  const handleLogin = (who) => {
    if (who) localStorage.setItem(USER_KEY, who);
    setUsername(who || "");
    setLoggedIn(true);
  };
  const handleLogout = async () => {
    await phoneRef.current?.stop();
    clearToken();
    localStorage.removeItem(USER_KEY);
    setLoggedIn(false);
    window.location.reload();
  };

  const handleDial = async (number) => {
    if (!number || currentCall) return;
    startCall(number);
    try {
      // Tag this call to the logged-in user before it hits the shared SIP line.
      await api.claim(number).catch(() => {});
      await phoneRef.current.call(number);
    } catch (e) {
      setError(e.message);
      endCall();
    }
  };

  const handleAccept = () => { acceptIncoming(); phoneRef.current?.answer(); };
  const handleDecline = () => { clearIncoming(); phoneRef.current?.hangup(); };
  const handleHangup = () => { phoneRef.current?.hangup(); endCall(); };
  const handleMute = () => {
    const muted = !currentCall?.muted;
    phoneRef.current?.setMuted(muted);
    updateCall({ muted });
  };
  const handleDtmf = (tone) => phoneRef.current?.sendDtmf(tone);
  const handleSpeaker = (on) => phoneRef.current?.setSpeaker(on);

  // Start a "call two numbers at once" conference.
  const handleConferenceStart = async (phone1, phone2) => {
    if (conference || currentCall) return;
    try {
      confStartingRef.current = true; // auto-answer our own leg when it rings
      const { room } = await api.startConference(phone1, phone2);
      startConferenceState(room, phone1, phone2);
    } catch (e) {
      confStartingRef.current = false;
      setError(e.message);
    }
  };
  const handleConferenceHangup = async () => {
    const room = conference?.room;
    endConferenceState();
    phoneRef.current?.hangup(); // drop our browser leg
    if (room) await api.endConference(room).catch(() => {});
    bumpHistory();
  };

  if (!loggedIn) return <Login onLogin={handleLogin} />;

  const initials = (username || "?").slice(0, 2).toUpperCase();

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <BrandMark size={30} />
          <span className="logo-text">Soft<span className="pad">Pad</span></span>
        </div>
        <div className="topbar-right">
          <span className="reg-pill">
            <span className={`dot ${registered ? "on" : "off"}`} />
            {registered ? "Registered" : "Connecting…"}
          </span>
          <span className="user-chip">
            <span className="avatar-sm">{initials}</span>
            {username}
          </span>
          <button className="icon-btn" onClick={handleLogout} title="Sign out">
            <LogOutIcon size={17} />
          </button>
        </div>
      </header>

      {error && <div className="banner error">{error}</div>}

      <main className="layout">
        <section className="panel phone-panel">
          {(numbers.inbound || numbers.outbound) && (
            <div className="line-numbers">
              <div className="line-num">
                <span className="ln-ico in"><PhoneIncomingIcon size={15} /></span>
                <div className="ln-meta">
                  <span className="ln-label">Inbound number</span>
                  <span className="ln-value">{numbers.inbound || "—"}</span>
                </div>
              </div>
              <div className="line-num">
                <span className="ln-ico out"><PhoneOutgoingIcon size={15} /></span>
                <div className="ln-meta">
                  <span className="ln-label">Calls show as</span>
                  <span className="ln-value">{numbers.outbound || "—"}</span>
                </div>
              </div>
            </div>
          )}
          {conference ? (
            <ConferenceCall conf={conference} onHangup={handleConferenceHangup} />
          ) : currentCall ? (
            <InCall
              call={currentCall}
              onHangup={handleHangup}
              onMute={handleMute}
              onDtmf={handleDtmf}
              onSpeaker={handleSpeaker}
            />
          ) : (
            <>
              <div className="mode-tabs">
                <button
                  className={`mode-tab ${mode === "single" ? "active" : ""}`}
                  onClick={() => setMode("single")}
                >
                  <PhoneIcon size={15} /> Single call
                </button>
                <button
                  className={`mode-tab ${mode === "multi" ? "active" : ""}`}
                  onClick={() => setMode("multi")}
                >
                  <PhoneOutgoingIcon size={15} /> Call two
                </button>
              </div>
              {mode === "single" ? (
                <Dialer onDial={handleDial} disabled={!registered} />
              ) : (
                <MultiCallForm onStart={handleConferenceStart} disabled={!registered} />
              )}
            </>
          )}
        </section>

        <CallHistory reloadKey={historyVersion} onCall={handleDial} />
      </main>

      {/* Heads-up popup — overlays the dashboard, never takes the whole screen */}
      {incomingCall && (
        <IncomingCall
          number={incomingCall.number}
          onAccept={handleAccept}
          onDecline={handleDecline}
        />
      )}
    </div>
  );
}
