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

export default function App() {
  const [loggedIn, setLoggedIn] = useState(!!getToken());
  const phoneRef = useRef(null);
  const wsRef = useRef(null);

  const {
    registered, currentCall, incomingCall, history, error,
    setRegistered, setError, startCall, updateCall, endCall, setHistory,
    setIncoming, clearIncoming, acceptIncoming,
  } = useStore();

  const refreshHistory = () => api.calls().then(setHistory).catch(() => {});

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
          // Inbound call ringing → show the accept/decline screen.
          onIncoming: (number) => setIncoming(number),
          onSessionState: (state) => {
            const st = useStore.getState();
            if (state === SessionState.Establishing && st.currentCall) {
              updateCall({ status: "dialing" });
            }
            if (state === SessionState.Established) {
              // Inbound just got answered → promote ring to the active call.
              if (st.incomingCall && !st.currentCall) acceptIncoming();
              // Only set answered/timer if not already answered (the optimistic
              // Accept may have set it already — don't restart the timer).
              else if (st.currentCall && st.currentCall.status !== "answered") {
                updateCall({ status: "answered", answeredAt: Date.now() });
              }
            }
            if (state === SessionState.Terminated) {
              clearIncoming();
              endCall();
              refreshHistory();
            }
          },
        });
        if (cancelled) return;
        phoneRef.current = phone;
        await phone.start();

        // Live, server-truth call status from the backend (AMI-derived).
        wsRef.current = connectEvents((evt) => {
          if (evt.type !== "call") return;
          if (["dialing", "ringing", "answered"].includes(evt.status)) {
            updateCall({ status: evt.status });
          }
          if (["ended", "no-answer", "failed"].includes(evt.status)) {
            // Server truth: the call ended (often the REMOTE party hung up).
            // Clear the UI instantly and tear down the local SIP session, rather
            // than waiting for a SIP BYE to reach the browser (which can lag).
            clearIncoming();
            endCall();
            phoneRef.current?.hangup();
            refreshHistory();
          }
        });

        refreshHistory();
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

  const handleLogin = () => setLoggedIn(true);
  const handleLogout = async () => {
    await phoneRef.current?.stop();
    clearToken();
    setLoggedIn(false);
    window.location.reload();
  };

  const handleDial = async (number) => {
    if (!number || currentCall) return;
    startCall(number);
    try {
      await phoneRef.current.call(number);
    } catch (e) {
      setError(e.message);
      endCall();
    }
  };

  // Accept: switch to the in-call screen INSTANTLY (optimistic), then negotiate
  // media in the background — so the green button feels responsive.
  const handleAccept = () => {
    acceptIncoming();
    phoneRef.current?.answer();
  };
  // Decline: clear the ringing screen instantly, then reject the SIP session.
  const handleDecline = () => {
    clearIncoming();
    phoneRef.current?.hangup();
  };
  // Hangup: clear the call from the UI INSTANTLY, then send the SIP BYE in the
  // background — so the red button doesn't wait on the BYE round-trip.
  const handleHangup = () => {
    endCall();
    phoneRef.current?.hangup();
  };
  const handleMute = () => {
    const muted = !currentCall?.muted;
    phoneRef.current?.setMuted(muted);
    updateCall({ muted });
  };
  const handleDtmf = (tone) => phoneRef.current?.sendDtmf(tone);
  const handleSpeaker = (on) => phoneRef.current?.setSpeaker(on);

  if (!loggedIn) return <Login onLogin={handleLogin} />;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">📞 SoftPhone <span>· Vocallabs</span></div>
        <div className="status">
          <span className={`dot ${registered ? "on" : "off"}`} />
          {registered ? "Registered" : "Connecting…"}
          <button className="link" onClick={handleLogout}>Logout</button>
        </div>
      </header>

      {error && <div className="banner error">{error}</div>}

      <main className="layout">
        <section className="phone-col">
          <div className="device">
            <div className="notch" />
            {incomingCall ? (
              <IncomingCall
                number={incomingCall.number}
                onAccept={handleAccept}
                onDecline={handleDecline}
              />
            ) : currentCall ? (
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
          </div>
        </section>
        <section className="history-col">
          <CallHistory history={history} />
        </section>
      </main>
    </div>
  );
}
