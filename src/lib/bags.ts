import { prisma } from "./prisma";
import { fromDbType, SERVICES, toDbType, type Service } from "./classify";
import { isBagged, type ClosedBag } from "./bagNames";

export * from "./bagNames";



/** The open bag number for each service at an office on a day: one more than its last closed bag. */
export async function currentBags(office: string, day: string): Promise<Record<Service, number>> {
  const closed = await prisma.bagClose.findMany({ where: { office, day }, select: { type: true, number: true } });
  const out: Record<Service, number> = { registered: 1, express: 1, parcel: 1 };
  for (const c of closed) {
    const t = fromDbType(c.type);
    out[t] = Math.max(out[t], c.number + 1);
  }
  return out;
}

export async function currentBag(office: string, day: string, type: Service): Promise<number> {
  if (!isBagged(type)) return 1;
  const last = await prisma.bagClose.findFirst({
    where: { office, day, type: toDbType(type) },
    orderBy: { number: "desc" },
    select: { number: true },
  });
  return (last?.number ?? 0) + 1;
}

/** Closed bags for an office and day, with how many items each holds, in service then bag order. */
export async function closedBags(office: string, day: string): Promise<ClosedBag[]> {
  const rows = await prisma.bagClose.findMany({
    where: { office, day },
    orderBy: [{ type: "asc" }, { number: "asc" }],
    include: { closedBy: { select: { name: true } } },
  });
  const counts = await prisma.post.groupBy({ by: ["type", "bag"], where: { office, day }, _count: { _all: true } });
  return rows
    .map((r) => ({
      type: fromDbType(r.type),
      number: r.number,
      closedAt: r.closedAt.toISOString(),
      closedBy: r.closedBy.name,
      count: counts.find((c) => c.type === r.type && c.bag === r.number)?._count._all ?? 0,
    }))
    .sort((a, b) => SERVICES.indexOf(a.type) - SERVICES.indexOf(b.type) || a.number - b.number);
}



