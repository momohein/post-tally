"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const res = await signIn("credentials", { email, password, redirect: false });
    setBusy(false);
    if (res?.ok && !res.error) window.location.href = "/";
    else if (!res?.error || res.error === "CredentialsSignin") setError("Email or password is wrong. Ask your admin if you need a login.");
    else if (res.error === "DatabaseUnavailable") setError("Sign-in can't reach the database. Check DATABASE_URL in the server settings.");
    else setError(`Sign-in isn't set up correctly on the server (${res.error}). Check NEXTAUTH_SECRET and NEXTAUTH_URL.`);
  }

  return (
    <main className="wrap">
      <form className="card login" onSubmit={onSubmit}>
        <div>
          <h1>Post Tally</h1>
          <div className="sub">Sign in to record posts</div>
        </div>
        <label className="field">
          <span>Email</span>
          <input id="email" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field">
          <span>Password</span>
          <input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <div className="status err" role="alert">{error}</div>}
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
