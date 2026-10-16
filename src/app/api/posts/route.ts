import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { currentUser } from "@/lib/auth";
import { cleanTracking, isTrackingFormat, SERVICES, toDbType } from "@/lib/classify";
import { dayOf, isDay } from "@/lib/day";
import { postInclude, toDTO, type PostDTO } from "@/lib/posts";

export const dynamic = "force-dynamic";

/** GET /api/posts?day=YYYY-MM-DD — the day's records, newest first, plus totals. */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const q = new URL(req.url).searchParams.get("day");
  const day = isDay(q) ? q : dayOf();
  const rows = await prisma.post.findMany({
    where: { day },
    orderBy: { scannedAt: "desc" },
    include: postInclude,
  });
  const posts: PostDTO[] = rows.map(toDTO);
  const totals = { registered: 0, express: 0, parcel: 0 };
  posts.forEach((p) => totals[p.type]++);
  return NextResponse.json({ day, today: dayOf(), totals, posts });
}

const Body = z.object({
  trackingNumber: z.string().max(40).optional().default(""),
  type: z.enum(SERVICES as [string, ...string[]]),
  address: z.string().max(500).optional().default(""),
  // Set when staff confirmed they want to overwrite an existing record.
  replace: z.boolean().optional().default(false),
});

/** POST /api/posts — save one item. 409 if the tracking number is already recorded. */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Choose a service and check the details." }, { status: 400 });
  }
  const trackingNumber = cleanTracking(parsed.data.trackingNumber) || null;
  // Format is enforced here; a failed check digit is only a warning the phone shows before saving.
  if (trackingNumber && !isTrackingFormat(trackingNumber)) {
    return NextResponse.json(
      { error: "Tracking numbers are 2 letters, 9 digits, then 2 letters, like RL 7827 3725 8IE." },
      { status: 400 },
    );
  }

  const now = new Date();
  const data = {
    trackingNumber,
    type: toDbType(parsed.data.type as (typeof SERVICES)[number]),
    address: parsed.data.address.trim() || null,
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
