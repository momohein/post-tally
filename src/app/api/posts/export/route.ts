import { prisma } from "@/lib/prisma";
import { currentUser } from "@/lib/auth";
import { dayOf, isDay, TZ } from "@/lib/day";
import { postInclude, toDTO, type PostDTO } from "@/lib/posts";

export const dynamic = "force-dynamic";
const cell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

/** GET /api/posts/export?day=YYYY-MM-DD — the day's records as a CSV download. */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return new Response("Sign in first.", { status: 401 });

  const q = new URL(req.url).searchParams.get("day");
  const day = isDay(q) ? q : dayOf();
  const rows: PostDTO[] = (
    await prisma.post.findMany({ where: { day }, orderBy: { scannedAt: "asc" }, include: postInclude })
  ).map(toDTO);

  const time = (iso: string) =>
    new Intl.DateTimeFormat("en-IE", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
  const lines = [
    ["Time", "Tracking number", "Service", "Address", "Scanned by"].join(","),
    ...rows.map((r) =>
      [time(r.scannedAt), r.trackingNumber, r.type, (r.address ?? "").replace(/\n/g, ", "), r.scannedBy]
        .map(cell)
        .join(","),
    ),
  ];

  return new Response(lines.join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="post-tally-${day}.csv"`,
    },
  });
}
