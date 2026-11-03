import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * The automatic daily report email is switched off.
 * Reports are only sent when an admin presses "Email report" in the app (POST /api/reports/send).
 */
export async function GET() {
  return NextResponse.json({ ok: true, skipped: "Automatic report email is off. Use the Email report button." });
}
