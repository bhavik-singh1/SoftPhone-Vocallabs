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
import { BrandMark, LogOutIcon } from "./components/icons.jsx";

const USER_KEY = "sp_user";

export default function App() {
  const [loggedIn, setLoggedIn] = useState(!!getToken());
  const phoneRef = useRef(null);
  const wsRef = useRef(null);

  const {
    registered, currentCall, incomingCall, username, historyVersion, error,
    setRegistered, setUsername, setError, startCall, updateCall, endCall,
    setIncoming, clearIncoming, acceptIncoming, bumpHistory,
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
        const phone = new SipPhone(sipConfig, {
          onRegistered: () => setRegistered(true),
          onUnregistered: () => setRegistered(false),
          onIncoming: (number) => setIncoming(number),
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
          if (evt.type !== "call") return;
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

  if (!loggedIn) return <Login onLogin={handleLogin} />;

  const initials = (username || "?").slice(0, 2).toUpperCase();

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <BrandMark size={30} />
          <span className="logo-text">Soft<span className="pad">Pad</span></span>
          <span className="brand-sub">Vocallabs</span>
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
          {currentCall ? (
            <InCall
              call={currentCall}
              onHangup={handleHangup}
              onMute={handleMute}
              onDtmf={handleDtmf}
              onSpeaker={handleSpeaker}
            />
          ) : (
            <Dialer onDial={handleDial} disabled={!registered} />
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
