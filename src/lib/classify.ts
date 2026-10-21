export type Service = "registered" | "express" | "parcel";
export const SERVICES: Service[] = ["registered", "express", "parcel"];

/** Upper-case and strip spaces/dashes: "rr 123 456 789 ie" -> "RR123456789IE". */
export function cleanTracking(input: string | null | undefined): string {
  return (input ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** True for a UPU S10 number: 2 letters, 9 digits, 2-letter country code. */
export function isS10(tracking: string): boolean {
  return /^[A-Z]{2}\d{9}[A-Z]{2}$/.test(tracking);
}

/**
 * True when the S10 check digit (the 9th digit) matches the first 8.
 * Catches most single-digit misreads, e.g. "RL063790415IE" passes.
 */
export function s10CheckOk(tracking: string): boolean {
  const t = cleanTracking(tracking);
  if (!isS10(t)) return false;
  const weights = [8, 6, 4, 2, 3, 5, 9, 7];
  const sum = weights.reduce((acc, w, i) => acc + w * Number(t[2 + i]), 0);
  let check = 11 - (sum % 11);
  if (check === 10) check = 0;
  if (check === 11) check = 5;
  return check === Number(t[10]);
}

/**
 * Service from the S10 prefix's first letter:
 * R = registered, E (EMS) or L (letter express, e.g. An Post Express Post "LL...") = express, C or V = parcel.
 * Returns null when the number is not S10 or the prefix is not one of these.
 * Check which prefixes your post office's domestic labels use and adjust here.
 */
export function classify(input: string | null | undefined): Service | null {
  const t = cleanTracking(input);
  if (!isS10(t)) return null;
  switch (t[0]) {
    case "R":
      return "registered";
    case "E":
    case "L":
      return "express";
    case "C":
    case "V":
      return "parcel";
    default:
      return null;
  }
}

export function toDbType(s: Service): "REGISTERED" | "EXPRESS" | "PARCEL" {
  return s.toUpperCase() as "REGISTERED" | "EXPRESS" | "PARCEL";
}

export function fromDbType(t: string): Service {
  return t.toLowerCase() as Service;
}
