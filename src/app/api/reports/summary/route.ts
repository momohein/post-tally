import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { currentUser } from "@/lib/auth";
import { dayOf, isDay } from "@/lib/day";
import { isOffice, officeName } from "@/lib/offices";
import { dayLabelOf } from "@/lib/dayPdf";
import { recipients } from "@/lib/report";
import { groupByCompany } from "@/lib/companies";
import { bagName, groupByBag } from "@/lib/bags";
import { fromDbType } from "@/lib/classify";

export const dynamic = "force-dynamic";

/** GET /api/reports/summary?office=ringsend&day=YYYY-MM-DD — one office's report for the day, for an admin to preview before sending. */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (user.role !== "ADMIN") return NextResponse.json({ error: "Only an admin can view reports." }, { status: 403 });

  const params = new URL(req.url).searchParams;
  const office = params.get("office");
  if (!isOffice(office)) return NextResponse.json({ error: "Choose your post office first." }, { status: 400 });
  const q = params.get("day");
  const day = isDay(q) ? q : dayOf();
  const rows = await prisma.post.findMany({ where: { office, day }, select: { office: true, type: true, bag: true, listId: true, trackingNumber: true, scannedAt: true, list: { select: { sender: true } } },
    orderBy: { scannedAt: "asc" },
  });
  const items = rows.map((r) => ({
    listId: r.listId,
    listSender: r.list?.sender ?? "",
    trackingNumber: r.trackingNumber,
    type: fromDbType(r.type),
    bag: r.bag,
  }));
  const bags = groupByBag(items).map((g) => ({
    type: g.type,
    bag: g.bag,
    name: bagName(g.type, g.bag),
    count: g.rows.length,
    companies: groupByCompany(g.rows),
  }));

  const count = (t: string) => rows.filter((r) => r.type === t).length;
  const summary = {
    id: office,
    name: officeName(office),
    registered: count("REGISTERED"),
    express: count("EXPRESS"),
    parcel: count("PARCEL"),
    total: rows.length,
    lists: new Set(rows.map((r) => r.listId).filter(Boolean)).size,
  };

  return NextResponse.json({
    day,
    dayLabel: dayLabelOf(day),
    to: await recipients(),
    emailReady: Boolean(process.env.SMTP_USER && process.env.SMTP_PASS),
    office: summary,
    bags,
  });
}
