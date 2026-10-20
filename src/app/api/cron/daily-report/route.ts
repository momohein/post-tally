import { NextResponse } from "next/server";
import { dayOf, isDay } from "@/lib/day";
import { sendDayReport, ReportError } from "@/lib/report";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET /api/cron/daily-report — called by Vercel Cron every morning (see vercel.json).
 * Emails yesterday's report for both offices to the admins. Protected by CRON_SECRET.
 * Add ?day=YYYY-MM-DD to send a particular day.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Not allowed." }, { status: 401 });
  }
  const q = new URL(req.url).searchParams.get("day");
  // Runs early in the morning, so "yesterday" is the full working day just finished.
  const day = isDay(q) ? q : dayOf(new Date(Date.now() - 24 * 60 * 60 * 1000));
  try {
    const sent = await sendDayReport(day);
    return NextResponse.json({ ok: true, ...sent });
  } catch (e) {
    if (e instanceof ReportError) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("daily report failed", e);
    return NextResponse.json({ error: "Sending the report failed." }, { status: 502 });
  }
}
