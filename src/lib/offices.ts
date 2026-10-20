/** The post offices using this app. Add one here (with a new id) to support another branch. */
export const OFFICES = [
  { id: "ringsend", name: "Ringsend P.O." },
  { id: "ballsbridge", name: "Ballsbridge P.O." },
] as const;

export type OfficeId = (typeof OFFICES)[number]["id"];
export const OFFICE_IDS = OFFICES.map((o) => o.id) as [OfficeId, ...OfficeId[]];

export function isOffice(v: unknown): v is OfficeId {
  return typeof v === "string" && OFFICES.some((o) => o.id === v);
}

export function officeName(id: string | null | undefined): string {
  return OFFICES.find((o) => o.id === id)?.name ?? "Unknown office";
}
