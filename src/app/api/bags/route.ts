import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { currentUser } from "@/lib/auth";
import { dayOf } from "@/lib/day";
import { OFFICE_IDS } from "@/lib/offices";
import { toDbType } from "@/lib/classify";
import { bagName, currentBag } from "@/lib/bags";

export const dynamic = "force-dynamic";

const Body = z.object({
  office: z.enum(OFFICE_IDS),
  // Parcels aren't bagged.
  type: z.enum(["registered", "express"]),
  action: z.enum(["close", "reopen"]),
  // The bag the person was looking at, so a double tap can't close two bags.
  bag: z.number().int().min(1),
});

/**
 * POST /api/bags — close today's open bag for a service (it's full; new items go into the next bag),
 * or reopen the last closed bag if nothing has gone into the new one yet.
 */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose the office and bag first." }, { status: 400 });
  const { office, type, action, bag } = parsed.data;
  const day = dayOf();
  const open = await currentBag(office, day, type);
  const dbType = toDbType(type);

  if (action === "close") {
    if (bag !== open) {
      return NextResponse.json({ error: `${bagName(type, bag)} is already closed. Now filling ${bagName(type, open)}.` }, { status: 409 });
    }
    const inBag = await prisma.post.count({ where: { office, day, type: dbType, bag: open } });
    if (inBag === 0) return NextResponse.json({ error: `${bagName(type, open)} is empty.` }, { status: 400 });
    try {
      await prisma.bagClose.create({ data: { office, day, type: dbType, number: open, closedById: user.id } });
    } catch (e) {
      if ((e as { code?: string }).code !== "P2002") throw e; // someone closed it at the same moment
    }
    return NextResponse.json({ ok: true, closed: open, count: inBag, now: open + 1 });
  }

  // reopen
  const last = open - 1;
  if (last < 1 || bag !== last) return NextResponse.json({ error: "There's no closed bag to reopen." }, { status: 400 });
  const inNew = await prisma.post.count({ where: { office, day, type: dbType, bag: open } });
  if (inNew > 0) {
    return NextResponse.json({ error: `${bagName(type, open)} already has items, so ${bagName(type, last)} can't be reopened.` }, { status: 409 });
  }
  await prisma.bagClose.deleteMany({ where: { office, day, type: dbType, number: last } });
  return NextResponse.json({ ok: true, now: last });
}
