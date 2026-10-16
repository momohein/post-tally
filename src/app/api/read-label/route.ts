import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { currentUser } from "@/lib/auth";
import { readLabel, LabelReadError } from "@/lib/readLabel";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Turn a Claude API error into a message staff (and whoever runs the server) can act on. */
function explain(e: unknown): string {
  if (e instanceof Anthropic.APIError) {
    const msg = (e.message || "").toLowerCase();
    if (e.status === 401) return "The Claude API key was rejected. Check ANTHROPIC_API_KEY in .env, then restart the app.";
    if (e.status === 403) return "This API key isn't allowed to make this request. Check the key's permissions in the Anthropic console.";
    if (msg.includes("credit")) return "The Anthropic account has no API credit left. Add credit under Billing in the Anthropic console.";
    if (e.status === 404 || msg.includes("model")) {
      return `The label-reading model "${process.env.CLAUDE_MODEL || "claude-haiku-5-5"}" wasn't found. Check CLAUDE_MODEL in .env.`;
    }
    if (e.status === 429) return "Too many labels read at once. Wait a minute and try again.";
    if (e.status && e.status >= 500) return "The label-reading service is busy. Try again in a moment.";
    return `Label reading failed (${e.status ?? "error"}): ${e.message}`;
  }
  return "Reading failed. Check the Mac running the app is online, then try again or type it in.";
}

const TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
const MAX_BYTES = 5 * 1024 * 1024;

/** POST /api/read-label — multipart form with an "image" file. Photos are read, never stored. */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("image");
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: "No photo was sent." }, { status: 400 });
  }
  const type = TYPES.find((t) => t === file.type);
  if (!type) return NextResponse.json({ error: "Send a JPEG, PNG or WebP photo." }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "That photo is too large." }, { status: 413 });

  try {
    const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");
    const reading = await readLabel(base64, type);
    return NextResponse.json(reading);
  } catch (e) {
    if (e instanceof LabelReadError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("read-label failed", e);
    return NextResponse.json({ error: explain(e) }, { status: 502 });
  }
}
