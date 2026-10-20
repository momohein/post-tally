import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { readLabel, LabelReadError } from "@/lib/readLabel";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
    return NextResponse.json({ error: "Reading failed. Try again or type it in." }, { status: 502 });
  }
}
