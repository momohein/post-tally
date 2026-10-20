import { currentUser } from "@/lib/auth";
import { dayOf, isDay } from "@/lib/day";
import { PAGE_SIZES, type PageSize } from "@/lib/pdf";
import { isOffice } from "@/lib/offices";
import { officeDayPdf } from "@/lib/dayPdf";

export const dynamic = "force-dynamic";

/**
 * GET /api/posts/export/pdf?office=ringsend&day=YYYY-MM-DD&size=label|a4
 * One office's records for the day as a printable PDF. "label" (default) is 100 × 150 mm (4 × 6 in) for thermal label printers.
 */
export async function GET(req: Request) {
  const user = await currentUser();
  if (!user) return new Response("Sign in first.", { status: 401 });

  const params = new URL(req.url).searchParams;
  const office = params.get("office");
  if (!isOffice(office)) return new Response("Choose your post office first.", { status: 400 });
  const q = params.get("day");
  const day = isDay(q) ? q : dayOf();
  const sizeParam = params.get("size") ?? "label";
  const size: PageSize = sizeParam in PAGE_SIZES ? (sizeParam as PageSize) : "label";

  const { pdf, filename } = await officeDayPdf(office, day, size);
  const download = params.get("download") === "1";
  return new Response(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      // Open in the browser's PDF viewer (with its Print button) unless a download was asked for.
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
