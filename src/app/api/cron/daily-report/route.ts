import { NextResponse } from "next/server";
import { dayOf, isDay, TZ } from "@/lib/day";
import { sendDayReport, ReportError } from "@/lib/report";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/cron/daily-report — called by Vercel Cron (see vercel.json) to email the day's report
 * for both offices to the admins at about 17:30 Irish time. Protected by CRON_SECRET.
 *
 * Vercel schedules in UTC, and Irish time is UTC+1 in summer and UTC+0 in winter, so it is called at
 * 16:30 and 17:30 UTC and only sends on the call that falls in the 17:00 hour in Dublin.
 * Add ?day=YYYY-MM-DD to send a particular day, or ?force=1 to send now whatever the time.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  }
  const params = new URL(req.url).searchParams;
  const q = params.get("day");
  const sendHour = Number(process.env.REPORT_HOUR ?? 17);
  const hourInIreland = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", hourCycle: "h23" }).format(new Date()),
  );
  if (!isDay(q) && params.get("force") !== "1" && hourInIreland !== sendHour) {
    return NextResponse.json({ ok: true, skipped: `It's ${hourInIreland}:xx in Ireland; the report goes at ${sendHour}:xx.` });
  }
  // The report covers the working day that's ending now.
  const day = isDay(q) ? q : dayOf();
  try {
    const sent = await sendDayReport(day);
    return NextResponse.json({ ok: true, ...sent });
  } catch (e) {
    if (e instanceof ReportError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("daily report failed", e);
    return NextResponse.json({ error: "Sending the report failed." }, { status: 502 });
  }
}
