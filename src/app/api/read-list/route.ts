import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { LabelReadError } from "@/lib/readLabel";
import { readList } from "@/lib/readList";
import { officeName } from "@/lib/offices";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
const MAX_BYTES = 5 * 1024 * 1024;

/** POST /api/read-list — multipart form with an "image" of a posting list. Photos are read, never stored. */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("image");
  if (!(file instanceof Blob)) return NextResponse.json({ error: "No photo was sent." }, { status: 400 });
  const type = TYPES.find((t) => t === file.type);
  if (!type) return NextResponse.json({ error: "Send a JPEG, PNG or WebP photo." }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "That photo is too large." }, { status: 413 });

  try {
    const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");
    const reading = await readList(base64, type);

    // Flag lines whose tracking number is already in the system.
    const numbers = reading.items.map((i) => i.trackingNumber).filter(Boolean);
    const existing = numbers.length
      ? await prisma.post.findMany({ where: { trackingNumber: { in: numbers } }, select: { trackingNumber: true, day: true, office: true } })
      : [];
    const seen = new Map(existing.map((e) => [e.trackingNumber, `${officeName(e.office)} on ${e.day}`]));
    const items = reading.items.map((i) =>
      seen.has(i.trackingNumber) ? { ...i, problem: `Already recorded at ${seen.get(i.trackingNumber)}.` } : i,
    );
    return NextResponse.json({ sender: reading.sender, items, sheetTotal: reading.sheetTotal, service: reading.service });
  } catch (e) {
    if (e instanceof LabelReadError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("read-list failed", e);
    return NextResponse.json({ error: "Reading failed. Try again." }, { status: 502 });
  }
}
