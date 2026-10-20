import { prisma } from "./prisma";
import { postInclude, toDTO, type PostDTO } from "./posts";
import { buildPdf, type PageSize } from "./pdf";
import { officeName, type OfficeId } from "./offices";
import { TZ } from "./day";

/** "2026-10-20" -> "Tue 20 Oct 2026" */
export function dayLabelOf(day: string): string {
  return new Intl.DateTimeFormat("en-IE", { timeZone: "UTC", weekday: "short", day: "numeric", month: "short", year: "numeric" }).format(
    new Date(`${day}T12:00:00Z`),
  );
}

/** One office's records for a day, oldest first, and that day's PDF. */
export async function officeDayPdf(office: OfficeId, day: string, size: PageSize) {
  const rows: PostDTO[] = (
    await prisma.post.findMany({ where: { office, day }, orderBy: { scannedAt: "asc" }, include: postInclude })
  ).map(toDTO);
  const printedAt = new Intl.DateTimeFormat("en-IE", { timeZone: TZ, dateStyle: "short", timeStyle: "short" }).format(new Date());
  const time = (iso: string) =>
    new Intl.DateTimeFormat("en-IE", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
  const pdf = await buildPdf({ office: officeName(office), dayLabel: dayLabelOf(day), printedAt, time, rows, size });
  return { rows, pdf, filename: `post-tally-${office}-${day}-${size}.pdf` };
}
