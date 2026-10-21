import { SERVICES, type Service } from "./classify";

// Bag helpers that are safe to use in the browser (no database access).

/** Services that go into numbered bags. Parcels are too big for bags, so they aren't bagged. */
export const BAGGED: Service[] = ["registered", "express"];
export const isBagged = (t: Service) => BAGGED.includes(t);

export type ClosedBag = { type: Service; number: number; closedAt: string; closedBy: string; count: number };

export const SERVICE_LABEL: Record<Service, string> = { registered: "Registered", express: "Express", parcel: "Parcel" };

/** "Registered bag 2"; parcels aren't bagged, so just "Parcels". */
export function bagName(type: Service, bag: number) {
  return isBagged(type) ? `${SERVICE_LABEL[type]} bag ${bag}` : "Parcels";
}

/** Group items into bags: services in order (registered, express, parcel), then bag 1, 2, 3 ... */
export function groupByBag<T extends { type: Service; bag: number }>(rows: T[]): { type: Service; bag: number; rows: T[] }[] {
  const groups: { type: Service; bag: number; rows: T[] }[] = [];
  for (const r of rows) {
    const bag = isBagged(r.type) ? r.bag : 1; // all parcels together
    const g = groups.find((x) => x.type === r.type && x.bag === bag);
    if (g) g.rows.push(r);
    else groups.push({ type: r.type, bag, rows: [r] });
  }
  return groups.sort((a, b) => SERVICES.indexOf(a.type) - SERVICES.indexOf(b.type) || a.bag - b.bag);
}
