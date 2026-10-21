import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { currentUser } from "@/lib/auth";
import { cleanTracking, isS10, SERVICES, toDbType } from "@/lib/classify";
import { dayOf } from "@/lib/day";
import { OFFICE_IDS, officeName } from "@/lib/offices";
import { currentBag } from "@/lib/bags";

export const dynamic = "force-dynamic";

const Body = z.object({
  sender: z.string().max(500).optional().default(""),
  office: z.enum(OFFICE_IDS, { message: "Choose your post office first." }),
  // The service for every item on this list (registered or express certificate of posting).
  type: z.enum(SERVICES as ["registered", "express", "parcel"]).optional().default("registered"),
  items: z
    .array(z.object({ trackingNumber: z.string().max(40), address: z.string().max(500).optional().default("") }))
    .min(1, "The list has no items.")
    .max(200),
});

/**
 * POST /api/lists — save a company's posting list: one PostingList plus one Post per line.
 * All or nothing. 409 lists tracking numbers that are repeated or already recorded.
 */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the list and try again." }, { status: 400 });
  }

  const items = parsed.data.items.map((i) => ({ trackingNumber: cleanTracking(i.trackingNumber), address: i.address.trim() }));
  const bad = items.filter((i) => !isS10(i.trackingNumber)).map((i) => i.trackingNumber || "(blank)");
  if (bad.length) {
    return NextResponse.json({ error: `Fix these tracking numbers first: ${bad.join(", ")}.` }, { status: 400 });
  }

  const numbers = items.map((i) => i.trackingNumber);
  const repeated = numbers.filter((n, i) => numbers.indexOf(n) !== i);
  if (repeated.length) {
    return NextResponse.json({ error: `These appear twice on the list: ${[...new Set(repeated)].join(", ")}.`, duplicates: repeated }, { status: 409 });
  }
  const existing = await prisma.post.findMany({
    where: { trackingNumber: { in: numbers } },
    select: { trackingNumber: true, office: true },
  });
  if (existing.length) {
    const dupes = existing.map((e) => e.trackingNumber as string);
    const where = [...new Set(existing.map((e) => officeName(e.office)))].join(" and ");
    return NextResponse.json(
      { error: `Already recorded at ${where}: ${dupes.join(", ")}. Remove them from the list to save the rest.`, duplicates: dupes },
      { status: 409 },
    );
  }

  const now = new Date();
  const day = dayOf(now);
  // The whole list goes into the open bag for its service.
  const bag = await currentBag(parsed.data.office, day, parsed.data.type);
  try {
    const list = await prisma.postingList.create({
      data: {
        sender: parsed.data.sender.trim() || null,
        office: parsed.data.office,
        day,
        scannedAt: now,
        scannedById: user.id,
        posts: {
          create: items.map((i) => ({
            trackingNumber: i.trackingNumber,
            // Every item on a company list has the list's service (registered, express or parcel).
            type: toDbType(parsed.data.type),
            address: i.address || null,
            office: parsed.data.office,
            bag,
            day,
            scannedAt: now,
            scannedById: user.id,
          })),
        },
      },
      include: { _count: { select: { posts: true } } },
    });
    return NextResponse.json({ id: list.id, count: list._count.posts, bag }, { status: 201 });
  } catch (e) {
    // Someone saved one of these numbers at the same moment.
    if ((e as { code?: string }).code === "P2002") {
      return NextResponse.json({ error: "One of these items was just recorded by someone else. Scan the list again." }, { status: 409 });
    }
    throw e;
  }
}
