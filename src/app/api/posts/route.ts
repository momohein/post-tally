import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { currentUser } from "@/lib/auth";
import { cleanTracking, SERVICES, toDbType } from "@/lib/classify";
import { dayOf, isDay } from "@/lib/day";
import { postInclude, toDTO, type PostDTO } from "@/lib/posts";
import { isOffice, OFFICE_IDS } from "@/lib/offices";

export const dynamic = "force-dynamic";

/** GET /api/posts?office=ringsend&day=YYYY-MM-DD — one office's records for the day, newest first, plus totals. */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const params = new URL(req.url).searchParams;
  const office = params.get("office");
  if (!isOffice(office)) return NextResponse.json({ error: "Choose your post office first." }, { status: 400 });
  const q = params.get("day");
  const day = isDay(q) ? q : dayOf();
  const rows = await prisma.post.findMany({
    where: { office, day },
    orderBy: { scannedAt: "desc" },
    include: postInclude,
  });
  const posts: PostDTO[] = rows.map(toDTO);
  const totals = { registered: 0, express: 0, parcel: 0 };
  posts.forEach((p) => totals[p.type]++);
  return NextResponse.json({ office, day, today: dayOf(), totals, posts });
}

const Body = z.object({
  trackingNumber: z.string().max(40).optional().default(""),
  type: z.enum(SERVICES as [string, ...string[]]),
  address: z.string().max(500).optional().default(""),
  office: z.enum(OFFICE_IDS),
  // Set when staff confirmed they want to overwrite an existing record.
  replace: z.boolean().optional().default(false),
});

/** POST /api/posts — save one item. 409 if the tracking number is already recorded. */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const officeMissing = parsed.error.issues.some((i) => i.path[0] === "office");
    return NextResponse.json(
      { error: officeMissing ? "Choose your post office first." : "Choose a service and check the details." },
      { status: 400 },
    );
  }
  const trackingNumber = cleanTracking(parsed.data.trackingNumber) || null;
  if (trackingNumber && trackingNumber.length < 8) {
    return NextResponse.json({ error: "That tracking number looks too short. Check it against the label." }, { status: 400 });
  }

  const now = new Date();
  const data = {
    trackingNumber,
    type: toDbType(parsed.data.type as (typeof SERVICES)[number]),
    address: parsed.data.address.trim() || null,
    office: parsed.data.office,
    day: dayOf(now),
    scannedAt: now,
    scannedById: user.id,
  };

  if (trackingNumber) {
    const existing = await prisma.post.findUnique({ where: { trackingNumber }, include: postInclude });
    if (existing && !parsed.data.replace) {
      return NextResponse.json(
        { error: "This tracking number is already recorded.", existing: toDTO(existing) },
        { status: 409 },
      );
    }
    if (existing) {
      const updated = await prisma.post.update({ where: { id: existing.id }, data, include: postInclude });
      return NextResponse.json({ post: toDTO(updated), replaced: true });
    }
  }

  const created = await prisma.post.create({ data, include: postInclude });
  return NextResponse.json({ post: toDTO(created) }, { status: 201 });
}
