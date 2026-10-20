import { NextResponse } from "next/server";
import { z } from "zod";
import { currentUser } from "@/lib/auth";
import { dayOf } from "@/lib/day";
import { sendDayReport, ReportError } from "@/lib/report";
import { OFFICE_IDS } from "@/lib/offices";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const Body = z.object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), office: z.enum(OFFICE_IDS).optional() });

/** POST /api/reports/send — an admin emails a day's report right now, for one office (or both if no office is given). */
export async function POST(req: Request) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  if (user.role !== "ADMIN") return NextResponse.json({ error: "Only an admin can send reports." }, { status: 403 });

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  const day = (parsed.success && parsed.data.day) || dayOf();
  try {
    const sent = await sendDayReport(day, parsed.success ? parsed.data.office : undefined);
    return NextResponse.json({ ok: true, ...sent });
  } catch (e) {
    if (e instanceof ReportError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("send report failed", e);
    return NextResponse.json({ error: "Sending failed. Check the email settings and try again." }, { status: 502 });
  }
}
