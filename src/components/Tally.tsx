"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { signOut } from "next-auth/react";
import { cleanTracking, formatTracking, isTrackingFormat, SERVICES, trackingProblem, type Service } from "@/lib/classify";
import type { PostDTO } from "@/lib/posts";

type Props = { today: string; user: { id: string; name: string; role: "ADMIN" | "STAFF" } };
type Mode = "start" | "reading" | "form";
type Draft = { trackingNumber: string; type: Service | null; address: string };
type Status = { text: string; err?: boolean; undoId?: string };

const LABEL: Record<Service, string> = { registered: "Registered", express: "Express", parcel: "Parcel" };
const SERVICE_KEY = "post-tally:service";

/** Shrink a phone photo to at most 1600px on its long side as JPEG before upload. */
async function shrink(file: File): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.9));
    return blob ?? file;
  } catch {
    return file;
  }
}

function timeOf(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export default function Tally({ today, user }: Props) {
  const [day, setDay] = useState(today);
  const [posts, setPosts] = useState<PostDTO[] | null>(null);
  const [loadError, setLoadError] = useState("");
  // The service chosen BEFORE the photo. It stays selected between scans, so a batch
  // of registered items is: choose Registered once, then photo, photo, photo.
  const [service, setService] = useState<Service | null>(null);
  const [mode, setMode] = useState<Mode>("start");
  const [thumb, setThumb] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>({ trackingNumber: "", type: null, address: "" });
  const [note, setNote] = useState("");
  const [confirmedBadCheck, setConfirmedBadCheck] = useState(false);
  const [dupe, setDupe] = useState<PostDTO | null>(null);
  const [status, setStatus] = useState<Status>({ text: "" });
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Remember the last chosen service on this phone.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(SERVICE_KEY) as Service | null;
      if (saved && SERVICES.includes(saved)) setService(saved);
    } catch {}
  }, []);
  function chooseService(s: Service) {
    setService(s);
    try {
      localStorage.setItem(SERVICE_KEY, s);
    } catch {}
  }

  const load = useCallback(async (d: string) => {
    try {
      const res = await fetch(`/api/posts?day=${d}`, { cache: "no-store" });
      if (res.redirected || res.status === 401) return void (window.location.href = "/login");
      if (!res.ok) throw new Error();
      const json = await res.json();
      setPosts(json.posts);
      setLoadError("");
    } catch {
      setLoadError("Couldn't load records. Check your connection and reload.");
    }
  }, []);

  useEffect(() => {
    setPosts(null);
    load(day);
  }, [day, load]);

  const totals = { registered: 0, express: 0, parcel: 0 };
  posts?.forEach((p) => totals[p.type]++);
  const count = posts?.length ?? 0;

  function backToStart() {
    abortRef.current?.abort();
    if (thumb) URL.revokeObjectURL(thumb);
    setThumb(null);
    setNote("");
    setDupe(null);
    setConfirmedBadCheck(false);
    setMode("start");
    if (fileRef.current) fileRef.current.value = "";
  }

  function openForm(d: Draft, message = "") {
    setDraft(d);
    setNote(message);
    setDupe(null);
    setConfirmedBadCheck(false);
    setMode("form");
  }

  /** POST the record. Returns true when saved. Shows the duplicate warning on 409. */
  async function post(d: Draft, replace = false): Promise<boolean> {
    const res = await fetch("/api/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...d, replace }),
    });
    const json = await res.json().catch(() => ({}));
    if (res.status === 409) {
      openForm(d, "");
      setDupe(json.existing);
      return false;
    }
    if (!res.ok) {
      openForm(d, json.error ?? "Couldn't save. Try again.");
      return false;
    }
    const saved: PostDTO = json.post;
    const number = saved.trackingNumber ? formatTracking(saved.trackingNumber) : "Item";
    setStatus({
      text: `${json.replaced ? "Replaced" : "Saved"} ${number} as ${LABEL[saved.type]}.`,
      undoId: json.replaced ? undefined : saved.id,
    });
    backToStart();
    if (day !== today) setDay(today);
    else load(today);
    return true;
  }

  async function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !service) return;
    setStatus({ text: "" });
    setThumb(URL.createObjectURL(file));
    setMode("reading");
    const ctl = new AbortController();
    abortRef.current = ctl;
    const chosen = service;
    try {
      const body = new FormData();
      body.append("image", await shrink(file), "label.jpg");
      const res = await fetch("/api/read-label", { method: "POST", body, signal: ctl.signal });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        return openForm({ trackingNumber: "", type: chosen, address: "" }, json.error ?? "Reading failed. Type the details in.");
      }
      const d: Draft = { trackingNumber: json.trackingNumber ?? "", type: chosen, address: json.address ?? "" };
      // Number read cleanly and passes the check digit: save straight away under the chosen service.
      if (!json.trackingProblem) {
        setSaving(true);
        try {
          await post(d);
        } finally {
          setSaving(false);
        }
        return;
      }
      // Otherwise let staff fix it first.
      const missingAddress = d.address ? "" : " The address couldn't be read either.";
      openForm(d, json.trackingProblem + missingAddress);
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      openForm({ trackingNumber: "", type: chosen, address: "" }, "Reading failed. Check your connection or type it in.");
    }
  }

  async function onSubmit(replace = false) {
    if (!draft.type) return setNote("Choose the service: Registered, Express or Parcel.");
    const t = cleanTracking(draft.trackingNumber);
    if (t && !isTrackingFormat(t)) return setNote(trackingProblem(t)!);
    // A failed check digit can be saved, but only after a second tap.
    if (t && trackingProblem(t) && !confirmedBadCheck && !replace) {
      setConfirmedBadCheck(true);
      return setNote(`${trackingProblem(t)} Tap Save again to save it anyway.`);
    }
    setSaving(true);
    try {
      await post({ ...draft, trackingNumber: t }, replace);
    } catch {
      setNote("Couldn't save. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  async function undo(id: string) {
    setStatus({ text: "Removing…" });
    const res = await fetch(`/api/posts/${id}`, { method: "DELETE" });
    setStatus(res.ok ? { text: "Removed. Take the photo again." } : { text: "Couldn't remove it. Use Delete in the log.", err: true });
    load(day);
  }

  async function remove(id: string) {
    if (confirmDelete !== id) return setConfirmDelete(id);
    setConfirmDelete(null);
    const res = await fetch(`/api/posts/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      setStatus({ text: json.error ?? "Couldn't delete that record.", err: true });
    }
    load(day);
  }

  const dayLabel =
    day === today
      ? "Today's log"
      : "Log for " + new Date(day + "T12:00").toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });

  return (
    <main className="wrap">
      <header>
        <div>
          <h1>Post Tally</h1>
          <div className="sub">
            Signed in as {user.name} ·{" "}
            <button className="linkbtn" type="button" onClick={() => signOut({ callbackUrl: "/login" })}>
              Sign out
            </button>
          </div>
        </div>
        <label className="small-label">
          Day
          <input type="date" id="day" value={day} max={today} onChange={(e) => e.target.value && setDay(e.target.value)} />
        </label>
      </header>

      <section aria-label="Totals for this day">
        <div className="tally">
          {SERVICES.map((s) => (
            <div key={s} className={`t ${s}`}>
              <b>{totals[s]}</b>
              <span>{LABEL[s]}</span>
            </div>
          ))}
        </div>
        <div className="total">
          {count} item{count === 1 ? "" : "s"} recorded
        </div>
      </section>

      <section className="card" aria-label="Record an item">
        <h2>Record an item</h2>

        {mode === "start" && (
          <>
            <div style={{ display: "grid", gap: 8 }}>
              <div className="step">1. Choose the service</div>
              <div className="pick" role="group" aria-label="Service">
                {SERVICES.map((s) => (
                  <button key={s} type="button" className={s} aria-pressed={service === s} onClick={() => chooseService(s)}>
                    {LABEL[s]}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ display: "grid", gap: 8 }}>
              <div className="step">2. Photograph the label</div>
              <button className="btn primary big" type="button" disabled={!service || saving} onClick={() => fileRef.current?.click()}>
                {service ? `Take photo · ${LABEL[service]}` : "Choose a service first"}
              </button>
              <input ref={fileRef} id="photo" type="file" accept="image/*" capture="environment" hidden onChange={onPhoto} />
              <button
                className="btn ghost"
                type="button"
                disabled={!service}
                onClick={() => openForm({ trackingNumber: "", type: service, address: "" })}
              >
                Type it in instead
              </button>
            </div>
          </>
        )}

        {mode === "reading" && (
          <div className="preview">
            {thumb && <img src={thumb} alt="Photo of the label" />}
            <div>
              <div className="status">{saving ? "Saving…" : `Reading label for ${service ? LABEL[service] : ""}…`}</div>
              {!saving && (
                <button className="btn ghost small" type="button" onClick={backToStart} style={{ marginTop: 8 }}>
                  Stop
                </button>
              )}
            </div>
          </div>
        )}

        {mode === "form" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              onSubmit();
            }}
            style={{ display: "grid", gap: 12 }}
          >
            {note && <div className="note">{note}</div>}
            <label className="field">
              <span>Tracking number</span>
              <input
                id="tracking"
                type="text"
                className="mono-input"
                autoComplete="off"
                autoCapitalize="characters"
                placeholder="RL 7827 3725 8IE"
                value={draft.trackingNumber}
                onChange={(e) => {
                  setDraft((d) => ({ ...d, trackingNumber: e.target.value }));
                  setDupe(null);
                  setConfirmedBadCheck(false);
                }}
              />
            </label>
            <div className="field">
              <span>Service</span>
              <div className="seg" role="radiogroup" aria-label="Service">
                {SERVICES.map((s) => (
                  <button key={s} type="button" role="radio" aria-checked={draft.type === s} onClick={() => setDraft((d) => ({ ...d, type: s }))}>
                    {LABEL[s]}
                  </button>
                ))}
              </div>
            </div>
            <label className="field">
              <span>Address</span>
              <textarea
                id="address"
                rows={3}
                placeholder="As written on the item"
                value={draft.address}
                onChange={(e) => setDraft((d) => ({ ...d, address: e.target.value }))}
              />
            </label>
            {dupe && (
              <div className="note">
                {formatTracking(cleanTracking(draft.trackingNumber))} was already recorded on {dupe.day} at {timeOf(dupe.scannedAt)} as{" "}
                {LABEL[dupe.type]} by {dupe.scannedBy}.{" "}
                <button className="linkbtn danger" type="button" onClick={() => onSubmit(true)} disabled={saving}>
                  Replace that record
                </button>
              </div>
            )}
            <div className="row">
              <button className="btn primary" type="submit" disabled={saving}>
                {saving ? "Saving…" : "Save record"}
              </button>
              <button className="btn ghost" type="button" onClick={backToStart}>
                Discard
              </button>
            </div>
            <div className="hint">Check the tracking number against the label before saving.</div>
          </form>
        )}

        {status.text && (
          <div className={status.err ? "status err saved" : "status saved"} role="status">
            <span>{status.text}</span>
            {status.undoId && (
              <button className="linkbtn" type="button" onClick={() => undo(status.undoId!)}>
                Undo
              </button>
            )}
          </div>
        )}
        <div className="privacy">Photos are only read, never saved. Addresses are stored with each record.</div>
      </section>

      <section style={{ display: "grid", gap: 10 }} aria-label="Records for this day">
        <div className="loghead">
          <h2>{dayLabel}</h2>
          {count > 0 && (
            <a className="btn ghost small" href={`/api/posts/export?day=${day}`}>
              Download CSV
            </a>
          )}
        </div>
        <ul className="items">
          {loadError && <li className="empty">{loadError}</li>}
          {!loadError && posts === null && <li className="empty">Loading records…</li>}
          {!loadError && posts?.length === 0 && (
            <li className="empty">
              {day === today
                ? "Nothing recorded today yet. Choose a service and photograph the first label."
                : "Nothing was recorded on this day."}
            </li>
          )}
          {posts?.map((p) => {
            const canDelete = p.scannedById === user.id || user.role === "ADMIN";
            return (
              <li key={p.id}>
                <span className={`chip ${p.type}`}>{p.type}</span>
                <div className="mid">
                  <div className="mono">{p.trackingNumber ? formatTracking(p.trackingNumber) : "No tracking number"}</div>
                  {p.address && <div className="addr">{p.address}</div>}
                </div>
                <div className="side">
                  <span>{timeOf(p.scannedAt)}</span>
                  <span>{p.scannedBy}</span>
                  {canDelete && (
                    <button type="button" className={confirmDelete === p.id ? "linkbtn danger" : "linkbtn"} onClick={() => remove(p.id)}>
                      {confirmDelete === p.id ? "Tap to delete" : "Delete"}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </main>
  );
}
