import type { PostDTO } from "./posts";
import type { Service } from "./classify";

export type CompanyGroup = { name: string; type: Service; count: number; tracking: string[] };

/** The company name for a list: the first line of the sender box, or a fallback. */
export function companyName(sender: string | null | undefined): string {
  return (sender ?? "").split("\n")[0].trim() || "Company list (no name read)";
}

/**
 * Items that came from company lists, grouped by company name and service (in the order first seen),
 * with how many each company handed in and their tracking numbers in scan order.
 * A company with both registered and express lists gets one group for each.
 */
export function groupByCompany(rows: Pick<PostDTO, "listId" | "listSender" | "trackingNumber" | "type">[]): CompanyGroup[] {
  const groups = new Map<string, CompanyGroup>();
  for (const r of rows) {
    if (!r.listId) continue;
    const name = companyName(r.listSender);
    const key = name.toLowerCase().replace(/\s+/g, " ") + "|" + r.type;
    const g = groups.get(key) ?? { name, type: r.type, count: 0, tracking: [] };
    g.count++;
    if (r.trackingNumber) g.tracking.push(r.trackingNumber);
    groups.set(key, g);
  }
  return [...groups.values()];
}
