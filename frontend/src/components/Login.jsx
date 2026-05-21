import React, { useState } from "react";
import { api, setToken } from "../api.js";
import { BrandMark, UserIcon, LockIcon } from "./icons.jsx";

export default function Login({ onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const { token, username: who } = await api.login(username.trim(), password);
      setToken(token);
      onLogin(who);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="login-brand">
          <BrandMark size={34} />
          <span className="t">SoftPhone</span>
        </div>
        <p className="login-sub">Sign in to your calling dashboard.</p>

        <div className="field">
          <label htmlFor="u">Username</label>
          <div className="input-wrap">
            <span className="lead"><UserIcon size={16} /></span>
            <input
              id="u"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="username"
              autoFocus
              autoComplete="username"
            />
          </div>
        </div>

        <div className="field">
          <label htmlFor="p">Password</label>
          <div className="input-wrap">
            <span className="lead"><LockIcon size={16} /></span>
            <input
              id="p"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
            />
          </div>
        </div>

        {err && <div className="banner error" style={{ margin: "4px 0 10px" }}>{err}</div>}

        <button className="btn-primary" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>

        <div className="login-hint">
          Demo: <code>admin</code> / <code>admin123</code>
        </div>
      </form>
    </div>
  );
}
