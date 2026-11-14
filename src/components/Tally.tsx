"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { signOut } from "next-auth/react";
import { classify, cleanTracking, isS10, s10CheckOk, SERVICES, type Service } from "@/lib/classify";
import type { PostDTO } from "@/lib/posts";
import { BAGGED, bagName, groupByBag, isBagged, type ClosedBag } from "@/lib/bagNames";
import { isOffice, OFFICES, officeName, type OfficeId } from "@/lib/offices";

type Props = { today: string; user: { id: string; name: string; role: "ADMIN" | "STAFF" } };
type Mode = "start" | "reading" | "form" | "list-reading" | "list";
type ListRow = { key: number; line: number; trackingNumber: string; address: string; problem: string | null };
type Draft = { trackingNumber: string; type: Service | null; address: string };

const EMPTY: Draft = { trackingNumber: "", type: null, address: "" };
const LABEL: Record<Service, string> = { registered: "Registered", express: "Express", parcel: "Parcel" };

/** Load a photo for drawing: createImageBitmap where it works, otherwise an <img> (older iPhones/iPads). */
async function loadImage(file: File): Promise<{ img: CanvasImageSource; w: number; h: number }> {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    return { img: bmp, w: bmp.width, h: bmp.height };
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return { img, w: img.naturalWidth, h: img.naturalHeight };
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

/**
 * Shrink a phone photo to at most `max` px on its long side as JPEG before upload,
 * so it stays well under the server's upload limit and in a format the reader accepts.
 */
async function shrink(file: File, max = 1600): Promise<Blob> {
  try {
    const { img, w, h } = await loadImage(file);
    const scale = Math.min(1, max / Math.max(w, h));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.85));
    return blob ?? file;
  } catch {
    return file;
  }
}

/** The server's error message, or a plain one when the reply isn't JSON (e.g. the host rejected a huge upload). */
function errorText(res: Response, json: { error?: string }, fallback: string) {
  if (json.error) return json.error;
  if (res.status === 413) return "That photo is too large to send. Take it again a little further away.";
  if (res.status === 504) return "Reading took too long. Try again.";
  return `${fallback} (error ${res.status})`;
}

/** Why a list line needs checking, judged on the phone as staff edit it. */
function rowProblem(trackingNumber: string): string | null {
  const t = cleanTracking(trackingNumber);
  if (!t) return "Enter the tracking number.";
  if (!isS10(t)) return "Tracking number doesn't look complete.";
  if (!s10CheckOk(t)) return "Check digit doesn't match — a digit may be misread.";
  return null;
}

let rowKey = 0;

function timeOf(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

export default function Tally({ today, user }: Props) {
  const [day, setDay] = useState(today);
  // Which branch this device is at. Remembered on the device; undefined until read, null if never chosen.
  const [office, setOfficeState] = useState<OfficeId | null | undefined>(undefined);
  const [choosingOffice, setChoosingOffice] = useState(false);
  const [posts, setPosts] = useState<PostDTO[] | null>(null);
  const [bags, setBags] = useState<Record<Service, number>>({ registered: 1, express: 1, parcel: 1 });
  const [closed, setClosed] = useState<ClosedBag[]>([]);
  const [showAllBags, setShowAllBags] = useState(false);
  const [confirmClose, setConfirmClose] = useState<Service | null>(null);
  const [bagBusy, setBagBusy] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [mode, setMode] = useState<Mode>("start");
  const [thumb, setThumb] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [note, setNote] = useState("");
  const [dupe, setDupe] = useState<PostDTO | null>(null);
  const [status, setStatus] = useState<{ text: string; err?: boolean }>({ text: "" });
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [listSender, setListSender] = useState("");
  const [listRows, setListRows] = useState<ListRow[]>([]);
  const [listNote, setListNote] = useState("");
  const [sheetTotal, setSheetTotal] = useState<number | null>(null);
  const [listType, setListType] = useState<Service>("registered");
  const fileRef = useRef<HTMLInputElement>(null);
  const listFileRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem("postTally.office");
    } catch {}
    setOfficeState(isOffice(saved) ? saved : null);
  }, []);

  function setOffice(id: OfficeId) {
    try {
      localStorage.setItem("postTally.office", id);
    } catch {}
    setOfficeState(id);
    setChoosingOffice(false);
    setStatus({ text: "" });
  }

  const load = useCallback(async (d: string, o: OfficeId) => {
    try {
      const res = await fetch(`/api/posts?office=${o}&day=${d}`, { cache: "no-store" });
      if (res.redirected || res.status === 401) return void (window.location.href = "/login");
      if (!res.ok) throw new Error();
      const json = await res.json();
      setPosts(json.posts);
      if (json.currentBags) setBags(json.currentBags);
      setClosed(json.closedBags ?? []);
      setLoadError("");
    } catch {
      setLoadError("Couldn't load records. Check your connection and reload.");
    }
  }, []);

  useEffect(() => {
    if (!office) return;
    setPosts(null);
    load(day, office);
  }, [day, office, load]);

  const totals = { registered: 0, express: 0, parcel: 0 };
  posts?.forEach((p) => totals[p.type]++);
  const count = posts?.length ?? 0;

  function reset() {
    abortRef.current?.abort();
    if (thumb) URL.revokeObjectURL(thumb);
    setThumb(null);
    setDraft(EMPTY);
    setNote("");
    setDupe(null);
    setListSender("");
    setListRows([]);
    setListNote("");
    setSheetTotal(null);
    setListType("registered");
    setMode("start");
    if (fileRef.current) fileRef.current.value = "";
    if (listFileRef.current) listFileRef.current.value = "";
  }

  function openForm(d: Draft, message = "") {
    setDraft(d);
    setNote(message);
    setDupe(null);
    setMode("form");
  }

  async function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setStatus({ text: "" });
    setThumb(URL.createObjectURL(file));
    setMode("reading");
    const ctl = new AbortController();
    abortRef.current = ctl;
    try {
      const body = new FormData();
      body.append("image", await shrink(file), "label.jpg");
      const res = await fetch("/api/read-label", { method: "POST", body, signal: ctl.signal });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return openForm(EMPTY, errorText(res, json, "Reading failed. Type the details in"));
      const missing: string[] = json.missing ?? [];
      openForm(
        { trackingNumber: json.trackingNumber ?? "", type: json.type ?? null, address: json.address ?? "" },
        missing.length
          ? `Couldn't read the ${missing.join(" or ")}. Fill in what's missing.`
          : json.address
            ? ""
            : "Address couldn't be read — that's fine, you can save without it.",
      );
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      openForm(EMPTY, "Reading failed. Check your connection or type it in.");
    }
  }

  async function save(replace = false) {
    if (!draft.type) return setNote("Choose the service: registered, express or parcel.");
    setSaving(true);
    try {
      const res = await fetch("/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...draft, office, replace }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.status === 409) {
        setDupe(json.existing);
        return;
      }
      if (!res.ok) {
        setNote(json.error ?? "Couldn't save. Try again.");
        return;
      }
      const saved: PostDTO = json.post;
      setStatus({ text: `${json.replaced ? "Replaced" : "Saved"} ${saved.trackingNumber ?? "item"} in ${bagName(saved.type, saved.bag)}.` });
      reset();
      if (day !== today) setDay(today);
      else office && load(today, office);
    } catch {
      setNote("Couldn't save. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  async function onListPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setStatus({ text: "" });
    setThumb(URL.createObjectURL(file));
    setMode("list-reading");
    const ctl = new AbortController();
    abortRef.current = ctl;
    const fail = (msg: string) => {
      setListRows([]);
      setListNote(msg);
      setMode("list");
    };
    try {
      const body = new FormData();
      // Bigger than a single label so handwriting and every digit stay sharp.
      body.append("image", await shrink(file, 2400), "list.jpg");
      const res = await fetch("/api/read-list", { method: "POST", body, signal: ctl.signal });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return fail(errorText(res, json, "Reading failed. Try another photo"));
      const rows: ListRow[] = (json.items ?? []).map((it: Omit<ListRow, "key">) => ({ ...it, key: ++rowKey }));
      setListSender(json.sender ?? "");
      setListRows(rows);
      setSheetTotal(typeof json.sheetTotal === "number" ? json.sheetTotal : null);
      setListType(SERVICES.includes(json.service) ? json.service : "registered");
      const flagged = rows.filter((r) => r.problem).length;
      const notes: string[] = [];
      if (typeof json.sheetTotal === "number" && json.sheetTotal !== rows.length) {
        notes.push(`The sheet says ${json.sheetTotal} items but ${rows.length} tracking number${rows.length === 1 ? " was" : "s were"} found. Check the photo shows every row.`);
      }
      if (flagged) notes.push(`${flagged} tracking number${flagged === 1 ? " needs" : "s need"} checking against the sheet.`);
      setListNote(notes.join(" "));
      setMode("list");
    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      fail("Reading failed. Check your connection and try again.");
    }
  }

  function editRow(key: number, patch: Partial<ListRow>) {
    setListRows((rows) =>
      rows.map((r) => {
        if (r.key !== key) return r;
        const next = { ...r, ...patch };
        if (patch.trackingNumber !== undefined) next.problem = rowProblem(patch.trackingNumber);
        return next;
      }),
    );
  }

  async function saveList() {
    const blank = listRows.filter((r) => !cleanTracking(r.trackingNumber));
    if (blank.length) return setListNote("Some lines have no tracking number. Fill them in or remove them.");
    setSaving(true);
    try {
      const res = await fetch("/api/lists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          office,
          type: listType,
          sender: listSender,
          items: listRows.map((r) => ({ trackingNumber: r.trackingNumber, address: r.address })),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const dupes: string[] = json.duplicates ?? [];
        if (dupes.length) {
          setListRows((rows) =>
            rows.map((r) =>
              dupes.includes(cleanTracking(r.trackingNumber)) ? { ...r, problem: "Already recorded or repeated. Remove this line." } : r,
            ),
          );
        }
        return setListNote(json.error ?? "Couldn't save the list. Try again.");
      }
      const who = listSender.split("\n")[0];
      setStatus({
        text: `Saved ${json.count} ${listType} post${json.count === 1 ? "" : "s"}${who ? ` from ${who}` : ""} in ${bagName(listType, json.bag ?? 1)}.`,
      });
      reset();
      if (day !== today) setDay(today);
      else office && load(today, office);
    } catch {
      setListNote("Couldn't save. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  async function removeList(id: string) {
    const key = "list:" + id;
    if (confirmDelete !== key) return setConfirmDelete(key);
    setConfirmDelete(null);
    const res = await fetch(`/api/lists/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      setStatus({ text: json.error ?? "Couldn't delete that list.", err: true });
    }
    office && load(day, office);
  }

  const [sendingReport, setSendingReport] = useState(false);
  type OfficeSum = { id: string; name: string; registered: number; express: number; parcel: number; total: number; lists: number };
  type Summary = {
    day: string;
    dayLabel: string;
    to: string[];
    emailReady: boolean;
    office: OfficeSum;
    bags: { type: Service; bag: number; name: string; count: number; companies: { name: string; type: Service; count: number; tracking: string[] }[]; singles: string[] }[];
  };
  const [summary, setSummary] = useState<Summary | null>(null);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [summaryError, setSummaryError] = useState("");

  async function previewReport() {
    setSummaryOpen(true);
    setSummary(null);
    setSummaryError("");
    try {
      const res = await fetch(`/api/reports/summary?office=${office}&day=${day}`, { cache: "no-store" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return setSummaryError(json.error ?? "Couldn't load the report.");
      setSummary(json);
    } catch {
      setSummaryError("Couldn't load the report. Check your connection.");
    }
  }

  // Keep an open preview in step with the chosen day and office.
  useEffect(() => {
    if (summaryOpen) previewReport();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day, office]);
  async function emailReport() {
    setSendingReport(true);
    setStatus({ text: "Sending the report…" });
    try {
      const res = await fetch("/api/reports/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ day, office }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) return setStatus({ text: json.error ?? "Couldn't send the report.", err: true });
      setStatus({ text: `${office ? officeName(office) : "Office"} report emailed to ${(json.to ?? []).join(", ")}.` });
    } catch {
      setStatus({ text: "Couldn't send the report. Check your connection.", err: true });
    } finally {
      setSendingReport(false);
    }
  }

  async function changeBag(type: Service, action: "close" | "reopen") {
    if (!office) return;
    const n = bags[type];
    if (action === "close" && confirmClose !== type) return setConfirmClose(type);
    setConfirmClose(null);
    setBagBusy(true);
    try {
      const res = await fetch("/api/bags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ office, type, action, bag: action === "close" ? n : n - 1 }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) setStatus({ text: json.error ?? "Couldn't change the bag.", err: true });
      else if (action === "close")
        setStatus({ text: `${bagName(type, n)} closed with ${json.count} item${json.count === 1 ? "" : "s"}. Now filling ${bagName(type, n + 1)}.` });
      else setStatus({ text: `${bagName(type, n - 1)} reopened.` });
      setShowAllBags(false);
      await load(day, office);
    } catch {
      setStatus({ text: "Couldn't change the bag. Check your connection.", err: true });
    } finally {
      setBagBusy(false);
    }
  }

  async function remove(id: string) {
    if (confirmDelete !== id) return setConfirmDelete(id);
    setConfirmDelete(null);
    const res = await fetch(`/api/posts/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      setStatus({ text: json.error ?? "Couldn't delete that record.", err: true });
    }
    office && load(day, office);
  }

  // Company lists among some records, newest first.
  type ListEntry = { id: string; sender: string; type: Service; count: number; scannedAt: string; scannedBy: string; scannedById: string };
  function listsOf(ps: PostDTO[]): ListEntry[] {
    const out: ListEntry[] = [];
    ps.forEach((p) => {
      if (!p.listId) return;
      const l = out.find((x) => x.id === p.listId);
      if (l) l.count++;
      else out.push({ id: p.listId, sender: p.listSender ?? "", type: p.type, count: 1, scannedAt: p.scannedAt, scannedBy: p.scannedBy, scannedById: p.scannedById });
    });
    return out;
  }
  const isToday = day === today;
  // Today shows the open bags only (a fresh page per bag); "Show all bags" or a past day shows everything by bag.
  const viewAll = !isToday || showAllBags;
  const inOpenBag = (p: PostDTO) => !isBagged(p.type) || p.bag === bags[p.type];
  const visible = (posts ?? []).filter((p) => viewAll || inOpenBag(p));
  const groups: { key: string; title: string | null; rows: PostDTO[] }[] = viewAll
    ? groupByBag(visible).map((g) => ({
        key: `${g.type}-${g.bag}`,
        title: `${bagName(g.type, g.bag)} · ${g.rows.length} item${g.rows.length === 1 ? "" : "s"}`,
        rows: g.rows,
      }))
    : visible.length
      ? [{ key: "open", title: null, rows: visible }]
      : [];
  const flaggedRows = listRows.filter((r) => r.problem).length;

  const dayLabel =
    day === today
      ? "Today's log"
      : "Log for " + new Date(day + "T12:00").toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });

  return (
    <main className="wrap">
      <header>
        <div>
          <h1>Post Tally</h1>
          {office && (
            <div className="office">
              {officeName(office)}{" "}
              <button className="linkbtn" type="button" onClick={() => setChoosingOffice(true)}>
                Change
              </button>
            </div>
          )}
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

      {office !== undefined && (office === null || choosingOffice) && (
        <section className="card" aria-label="Choose your post office">
          <h2>Which post office are you at?</h2>
          <div className="officepick">
            {OFFICES.map((o) => (
              <button
                key={o.id}
                type="button"
                className={o.id === office ? "btn primary big" : "btn ghost big"}
                onClick={() => setOffice(o.id)}
              >
                {o.name}
              </button>
            ))}
          </div>
          <div className="hint">This device remembers your choice. Records are counted separately for each office.</div>
          {office && (
            <button className="linkbtn" type="button" onClick={() => setChoosingOffice(false)}>
              Cancel
            </button>
          )}
        </section>
      )}

      {office && !choosingOffice && (
      <>

      <section aria-label="Totals for this day">
        <div className="tally">
          {SERVICES.map((s) => (
            <div key={s} className={`t ${s}`}>
              <b>{totals[s]}</b>
              <span>{LABEL[s]}</span>
            </div>
          ))}
        </div>
        <div className="tally baglists">
          {SERVICES.map((s) => {
            const bagsOf = isBagged(s) ? groupByBag((posts ?? []).filter((p) => p.type === s)) : [];
            return (
              <ul key={s} className={`tbags ${s}`} aria-label={`${LABEL[s]} bags`}>
                {bagsOf.map((g) => (
                  <li key={g.bag} className={isToday && g.bag === bags[s] ? "open" : ""}>
                    Bag {g.bag}: <b>{g.rows.length}</b> item{g.rows.length === 1 ? "" : "s"}
                  </li>
                ))}
              </ul>
            );
          })}
        </div>
        <div className="total">
          {count} item{count === 1 ? "" : "s"} recorded
        </div>
      </section>

      {isToday && (
        <section className="card bags" aria-label="Bags">
          <h2>Bags</h2>
          {BAGGED.map((t) => {
            const n = bags[t];
            const inBag = (posts ?? []).filter((p) => p.type === t && p.bag === n).length;
            const done = closed.filter((c) => c.type === t);
            return (
              <div key={t} className={`bagrow ${t}`}>
                <div className="baginfo">
                  <b>{bagName(t, n)}</b>
                  <span>
                    {inBag} item{inBag === 1 ? "" : "s"} in this bag
                  </span>
                  {done.length > 0 && (
                    <span className="closedlist">Closed: {done.map((c) => `Bag ${c.number} (${c.count})`).join(" · ")}</span>
                  )}
                </div>
                <div className="bagactions">
                  <button
                    type="button"
                    className={confirmClose === t ? "btn primary small" : "btn ghost small"}
                    disabled={inBag === 0 || bagBusy}
                    onClick={() => changeBag(t, "close")}
                  >
                    {confirmClose === t ? `Tap again to close Bag ${n}` : `Bag full: start Bag ${n + 1}`}
                  </button>
                  {inBag === 0 && done.length > 0 && (
                    <button type="button" className="linkbtn" disabled={bagBusy} onClick={() => changeBag(t, "reopen")}>
                      Reopen Bag {n - 1}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </section>
      )}

      <section className="card" aria-label="Record an item">
        <h2>Record an item</h2>

        {mode === "start" && (
          <div className="row">
            <label className="btn primary big" htmlFor="photo">
              Take photo of label
            </label>
            <input ref={fileRef} id="photo" type="file" accept="image/*" capture="environment" hidden onChange={onPhoto} />
            <label className="btn blue big" htmlFor="listPhoto">
              Take photo of a company list
              <span className="btn-sub">Certificate of posting with many items</span>
            </label>
            <input ref={listFileRef} id="listPhoto" type="file" accept="image/*" capture="environment" hidden onChange={onListPhoto} />
            <button className="btn ghost big" type="button" onClick={() => openForm(EMPTY)}>
              Type it in instead
            </button>
          </div>
        )}

        {mode === "list-reading" && (
          <div className="preview">
            {thumb && <img src={thumb} alt="Photo of the posting list" />}
            <div>
              <div className="status">Reading every line on the list… this can take up to 30 seconds.</div>
              <button className="btn ghost small" type="button" onClick={reset} style={{ marginTop: 8 }}>
                Stop
              </button>
            </div>
          </div>
        )}

        {mode === "list" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              saveList();
            }}
            style={{ display: "grid", gap: 12 }}
          >
            <div className="listhead">
              <b>{listRows.length}</b>
              <span>
                {listType} post{listRows.length === 1 ? "" : "s"} counted on this page
                {sheetTotal !== null && (
                  <span className={sheetTotal === listRows.length ? "sheetok" : "sheetbad"}>
                    {sheetTotal === listRows.length ? ` · matches the sheet's total (${sheetTotal})` : ` · sheet says ${sheetTotal}`}
                  </span>
                )}
              </span>
              {thumb && <img src={thumb} alt="Photo of the posting list" />}
            </div>
            {listNote && <div className="note">{listNote}</div>}
            <div className="field">
              <span>This list is for</span>
              <div className="seg" role="radiogroup" aria-label="Service for this list">
                {SERVICES.map((sv) => (
                  <button key={sv} type="button" role="radio" aria-checked={listType === sv} onClick={() => setListType(sv)}>
                    {LABEL[sv]}
                  </button>
                ))}
              </div>
            </div>
            <label className="field">
              <span>Sender (customer)</span>
              <textarea rows={2} value={listSender} onChange={(e) => setListSender(e.target.value)} placeholder="Company name and address" />
            </label>
            <ol className="listrows">
              {listRows.map((r) => (
                <li key={r.key} className={r.problem ? "flag" : ""}>
                  <span className="lineno">{r.line}</span>
                  <div className="lineedit">
                    <input
                      type="text"
                      className="mono-input"
                      aria-label={`Tracking number, line ${r.line}`}
                      autoComplete="off"
                      value={r.trackingNumber}
                      onChange={(e) => editRow(r.key, { trackingNumber: e.target.value })}
                    />
                    <textarea
                      rows={2}
                      aria-label={`Name and address, line ${r.line}`}
                      placeholder="Name and address (optional)"
                      value={r.address}
                      onChange={(e) => editRow(r.key, { address: e.target.value })}
                    />
                    {r.problem && <div className="lineproblem">{r.problem}</div>}
                  </div>
                  <button
                    type="button"
                    className="linkbtn"
                    aria-label={`Remove line ${r.line}`}
                    onClick={() => setListRows((rows) => rows.filter((x) => x.key !== r.key))}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ol>
            <button
              type="button"
              className="btn ghost small"
              onClick={() =>
                setListRows((rows) => [
                  ...rows,
                  { key: ++rowKey, line: (rows.at(-1)?.line ?? 0) + 1, trackingNumber: "", address: "", problem: "Enter the tracking number." },
                ])
              }
            >
              Add a missed line
            </button>
            <div className="row">
              <button className="btn primary" type="submit" disabled={saving || listRows.length === 0}>
                {saving
                  ? "Saving…"
                  : `${flaggedRows ? "Save anyway: " : "Save "}${listRows.length} ${listType} post${listRows.length === 1 ? "" : "s"}`}
              </button>
              <button className="btn ghost" type="button" onClick={reset}>
                Discard
              </button>
            </div>
            <div className="hint">Compare the count and each tracking number with the sheet before saving.</div>
          </form>
        )}

        {mode === "reading" && (
          <div className="preview">
            {thumb && <img src={thumb} alt="Photo of the label" />}
            <div>
              <div className="status">Reading label…</div>
              <button className="btn ghost small" type="button" onClick={reset} style={{ marginTop: 8 }}>
                Stop
              </button>
            </div>
          </div>
        )}

        {mode === "form" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              save();
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
                placeholder="RR123456789IE"
                value={draft.trackingNumber}
                onChange={(e) => {
                  const trackingNumber = e.target.value;
                  setDraft((d) => ({ ...d, trackingNumber, type: classify(trackingNumber) ?? d.type }));
                  setDupe(null);
                }}
              />
            </label>
            <div className="field">
              <span>Service</span>
              <div className="seg" role="radiogroup" aria-label="Service">
                {SERVICES.map((s) => (
                  <button
                    key={s}
                    type="button"
                    role="radio"
                    aria-checked={draft.type === s}
                    onClick={() => setDraft((d) => ({ ...d, type: s }))}
                  >
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
                {cleanTracking(draft.trackingNumber)} was already recorded at {officeName(dupe.office)} on {dupe.day} at{" "}
                {timeOf(dupe.scannedAt)} by{" "}
                {dupe.scannedBy}.{" "}
                <button className="linkbtn danger" type="button" onClick={() => save(true)} disabled={saving}>
                  Replace that record
                </button>
              </div>
            )}
            <div className="row">
              <button className="btn primary" type="submit" disabled={saving}>
                {saving ? "Saving…" : "Save record"}
              </button>
              <button className="btn ghost" type="button" onClick={reset}>
                Discard
              </button>
            </div>
            <div className="hint">Check the tracking number against the label before saving.</div>
          </form>
        )}

        {status.text && (
          <div className={status.err ? "status err" : "status"} role="status">
            {status.text}
          </div>
        )}
        <div className="privacy">Photos are only read, never saved. Addresses are stored with each record.</div>
      </section>

      <section style={{ display: "grid", gap: 10 }} aria-label="Records for this day">
        <div className="loghead">
          <h2>{isToday && !showAllBags ? "Open bags" : dayLabel}</h2>
          {isToday && closed.length > 0 && (
            <button className="linkbtn" type="button" onClick={() => setShowAllBags((v) => !v)}>
              {showAllBags ? "Show open bags only" : "Show all bags"}
            </button>
          )}
          {count > 0 && (
            <div className="exports">
              <a className="btn primary small" href={`/api/posts/export/pdf?office=${office}&day=${day}&size=label`} target="_blank" rel="noopener">
                Print PDF (label)
              </a>
              <a className="btn ghost small" href={`/api/posts/export/pdf?office=${office}&day=${day}&size=a4`} target="_blank" rel="noopener">
                A4
              </a>
              <a className="btn ghost small" href={`/api/posts/export?office=${office}&day=${day}`}>
                CSV
              </a>
            </div>
          )}
        </div>
        {user.role === "ADMIN" && (
          <div className="card reportbar" aria-label="Email report">
            <h2>Daily report</h2>
            <div className="reportbtns">
              <button className="btn gray" type="button" onClick={() => (summaryOpen ? setSummaryOpen(false) : previewReport())}>
                {summaryOpen ? "Close preview" : "Preview report"}
              </button>
              <button className="btn gray" type="button" onClick={emailReport} disabled={sendingReport}>
                {sendingReport ? "Sending…" : "Email report"}
              </button>
            </div>
          </div>
        )}
        {user.role === "ADMIN" && summaryOpen && (
          <div className="card report" aria-label="Report preview">
            <h2>
              {office ? officeName(office) : ""} report · {summary?.dayLabel ?? "…"}
            </h2>
            {summaryError && <div className="status err">{summaryError}</div>}
            {!summary && !summaryError && <div className="status">Loading…</div>}
            {summary && (
              <>
                <table className="sumtable">
                  <thead>
                    <tr>
                      <th scope="col">Office</th>
                      <th scope="col" className="reg">Registered</th>
                      <th scope="col" className="exp">Express</th>
                      <th scope="col" className="par">Parcel</th>
                      <th scope="col">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <th scope="row">
                        {summary.office.name}
                        {summary.office.lists > 0 && (
                          <span className="sumnote">
                            {summary.office.lists} company list{summary.office.lists === 1 ? "" : "s"}
                          </span>
                        )}
                      </th>
                      <td>{summary.office.registered}</td>
                      <td>{summary.office.express}</td>
                      <td>{summary.office.parcel}</td>
                      <td>
                        <b>{summary.office.total}</b>
                      </td>
                    </tr>
                  </tbody>
                </table>
                {summary.bags.length > 0 && (
                  <div className="companies">
                    {summary.bags.map((b) => (
                      <div key={b.type + b.bag} className="company">
                        <div className="companyhead">
                          <b>{b.name}</b>
                          <span className={b.type}>
                            {b.count} item{b.count === 1 ? "" : "s"}
                          </span>
                        </div>
                        {b.companies.map((c) => (
                          <div key={c.name} className="bagcompany">
                            <div className="companyhead">
                              <span className="cname">{c.name}</span>
                              <span className={c.type}>{c.count}</span>
                            </div>
                            <ol className="tracklist">
                              {c.tracking.map((t) => (
                                <li key={t}>{t}</li>
                              ))}
                            </ol>
                          </div>
                        ))}
                        {b.singles.length > 0 && (
                          <div className="bagcompany">
                            <div className="companyhead">
                              <span className="cname">Single items</span>
                              <span className={b.type}>{b.singles.length}</span>
                            </div>
                            <ol className="tracklist">
                              {b.singles.map((t, i) => (
                                <li key={t + i}>{t}</li>
                              ))}
                            </ol>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                <div className="row">
                  <a
                    className="btn ghost small"
                    href={`/api/posts/export/pdf?office=${summary.office.id}&day=${summary.day}&size=label`}
                    target="_blank"
                    rel="noopener"
                  >
                    Open PDF
                  </a>
                </div>
                <div className="hint">
                  {summary.emailReady
                    ? `Email goes to: ${summary.to.join(", ") || "no one yet"}`
                    : "Email isn't set up yet: add SMTP_USER and SMTP_PASS to the settings."}
                </div>
                <button className="btn primary big" type="button" onClick={emailReport} disabled={sendingReport || !summary.emailReady}>
                  {sendingReport ? "Sending…" : "Send this report"}
                </button>
              </>
            )}
          </div>
        )}
        {loadError && (
          <ul className="items">
            <li className="empty">{loadError}</li>
          </ul>
        )}
        {!loadError && posts === null && (
          <ul className="items">
            <li className="empty">Loading records…</li>
          </ul>
        )}
        {!loadError && posts !== null && groups.length === 0 && (
          <ul className="items">
            <li className="empty">
              {!isToday
                ? "Nothing was recorded on this day."
                : posts.length === 0
                  ? "Nothing recorded today yet. Take a photo of the first label to start the count."
                  : "The open bags are empty. Earlier bags are under Show all bags."}
            </li>
          </ul>
        )}
        {!loadError &&
          groups.map((g) => {
            const gLists = listsOf(g.rows);
            return (
              <div key={g.key} className="baggroup">
                {g.title && <div className="baglabel">{g.title}</div>}
                {gLists.length > 0 && (
                  <ul className="items lists" aria-label="Company lists">
                    {gLists.map((l) => {
              const canDelete = l.scannedById === user.id || user.role === "ADMIN";
              return (
                <li key={l.id}>
                  <span className="chip list">List</span>
                  <div className="mid">
                    <div className="listname">{l.sender.split("\n")[0] || "Company list"}</div>
                    <div className="addr">
                      {l.count} {l.type} item{l.count === 1 ? "" : "s"}
                    </div>
                  </div>
                  <div className="side">
                    <span>{timeOf(l.scannedAt)}</span>
                    <span>{l.scannedBy}</span>
                    {canDelete && (
                      <button
                        type="button"
                        className={confirmDelete === "list:" + l.id ? "linkbtn danger" : "linkbtn"}
                        onClick={() => removeList(l.id)}
                      >
                        {confirmDelete === "list:" + l.id ? "Tap to delete all" : "Delete list"}
                      </button>
                    )}
                  </div>
                </li>
              );
                    })}
                  </ul>
                )}
                {g.rows.length > 0 && (
                  <ul className="items">
                    {g.rows.map((p) => {
            const canDelete = p.scannedById === user.id || user.role === "ADMIN";
            return (
              <li key={p.id}>
                <span className={`chip ${p.type}`}>{p.type}</span>
                <div className="mid">
                  <div className="mono">{p.trackingNumber ?? "No tracking number"}</div>
                  {p.address && <div className="addr">{p.address}</div>}
                  {p.listId && <div className="fromlist">From list: {(p.listSender ?? "").split("\n")[0] || "company list"}</div>}
                </div>
                <div className="side">
                  <span>{timeOf(p.scannedAt)}</span>
                  <span>{p.scannedBy}</span>
                  {canDelete && (
                    <button
                      type="button"
                      className={confirmDelete === p.id ? "linkbtn danger" : "linkbtn"}
                      onClick={() => remove(p.id)}
                    >
                      {confirmDelete === p.id ? "Tap to delete" : "Delete"}
                    </button>
                  )}
                </div>
              </li>
            );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
      </section>
      </>
      )}
    </main>
  );
}
