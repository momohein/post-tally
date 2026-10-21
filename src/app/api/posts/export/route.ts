import { prisma } from "@/lib/prisma";
import { currentUser } from "@/lib/auth";
import { dayOf, isDay, TZ } from "@/lib/day";
import { postInclude, toDTO, type PostDTO } from "@/lib/posts";
import { isOffice, officeName } from "@/lib/offices";
import { bagName } from "@/lib/bags";

export const dynamic = "force-dynamic";
const cell = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;

/** GET /api/posts/export?office=ringsend&day=YYYY-MM-DD — one office's records for the day as a CSV download. */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return new Response("Sign in first.", { status: 401 });

  const params = new URL(req.url).searchParams;
  const office = params.get("office");
  if (!isOffice(office)) return new Response("Choose your post office first.", { status: 400 });
  const q = params.get("day");
  const day = isDay(q) ? q : dayOf();
  const rows: PostDTO[] = (
    await prisma.post.findMany({ where: { office, day }, orderBy: { scannedAt: "asc" }, include: postInclude })
  ).map(toDTO);

  const time = (iso: string) =>
    new Intl.DateTimeFormat("en-IE", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
  const lines = [
    ["Office", "Bag", "Time", "Tracking number", "Service", "Address", "Scanned by", "From list"].join(","),
    ...rows.map((r) =>
      [officeName(r.office), bagName(r.type, r.bag), time(r.scannedAt), r.trackingNumber, r.type, (r.address ?? "").replace(/\n/g, ", "), r.scannedBy, r.listId ? (r.listSender || "Company list").split("\n")[0] : ""]
        .map(cell)
        .join(","),
    ),
  ];

  return new Response(lines.join("\r\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="post-tally-${office}-${day}.csv"`,
    },
  });
}
