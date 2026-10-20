"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";

export default function RegisterPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (password !== confirm) {
      setError("The two passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Couldn't create the account. Try again.");
        setBusy(false);
        return;
      }
      const login = await signIn("credentials", { email, password, redirect: false });
      if (login?.ok) window.location.href = "/";
      else window.location.href = "/login";
    } catch {
      setError("No connection. Check your signal and try again.");
      setBusy(false);
    }
  }

  return (
    <main className="wrap">
      <form className="card login" onSubmit={onSubmit}>
        <div>
          <h1>Post Tally</h1>
          <div className="sub">Create your staff account</div>
        </div>
        <label className="field">
          <span>Your name</span>
          <input type="text" autoComplete="name" required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field">
          <span>Email</span>
          <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field">
          <span>Password</span>
          <input type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <label className="field">
          <span>Confirm password</span>
          <input type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </label>
        {error && <div className="status err" role="alert">{error}</div>}
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? "Creating account…" : "Create account"}
        </button>
        <div className="authswitch">
          Already have an account? <a href="/login">Sign in</a>
        </div>
      </form>
    </main>
  );
}
