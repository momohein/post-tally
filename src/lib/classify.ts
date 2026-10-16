export type Service = "registered" | "express" | "parcel";
export const SERVICES: Service[] = ["registered", "express", "parcel"];

/**
 * Normalise a tracking number: upper-case, no spaces or dashes.
 * "rl 7827 3725 8ie" -> "RL782737258IE".
 * In the 9-digit middle, letters that are common misreads of digits are corrected
 * (O->0, I/L->1, S->5, B->8, Z->2), since only digits are valid there.
 */
export function cleanTracking(input: string | null | undefined): string {
  let t = (input ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (t.length === 13) {
    const middle = t
      .slice(2, 11)
      .replace(/O/g, "0")
      .replace(/[IL]/g, "1")
      .replace(/S/g, "5")
      .replace(/B/g, "8")
      .replace(/Z/g, "2");
    t = t.slice(0, 2) + middle + t.slice(11);
  }
  return t;
}

/** Two letters, nine digits, two letters (UPU S10), e.g. RL782737258IE. */
export function isTrackingFormat(t: string): boolean {
  return /^[A-Z]{2}\d{9}[A-Z]{2}$/.test(t);
}

/**
 * S10 check digit: the 9th digit is computed from the first 8.
 * Weights 8 6 4 2 3 5 9 7; check = 11 - (sum mod 11), with 10 -> 0 and 11 -> 5.
 * A failed check almost always means one digit was misread.
 */
export function checkDigitOk(t: string): boolean {
  if (!isTrackingFormat(t)) return false;
  const weights = [8, 6, 4, 2, 3, 5, 9, 7];
  let sum = 0;
  for (let i = 0; i < 8; i++) sum += Number(t.charAt(2 + i)) * weights[i];
  let check = 11 - (sum % 11);
  if (check === 10) check = 0;
  else if (check === 11) check = 5;
  return check === Number(t.charAt(10));
}

/** What's wrong with a cleaned tracking number, in staff-facing words, or null if it looks right. */
export function trackingProblem(t: string): string | null {
  if (!t) return "No tracking number was found.";
  if (!isTrackingFormat(t)) {
    return "Tracking numbers are 2 letters, 9 digits, then 2 letters, like RL 7827 3725 8IE.";
  }
  if (!checkDigitOk(t)) {
    return "This number fails the check-digit test, so a digit is probably misread. Compare it with the label.";
  }
  return null;
}

/** Show a number the way it's printed on the label: "RL 7827 3725 8IE". */
export function formatTracking(t: string): string {
  if (!isTrackingFormat(t)) return t;
  return `${t.slice(0, 2)} ${t.slice(2, 6)} ${t.slice(6, 10)} ${t.slice(10)}`;
}

export function toDbType(s: Service): "REGISTERED" | "EXPRESS" | "PARCEL" {
  return s.toUpperCase() as "REGISTERED" | "EXPRESS" | "PARCEL";
}

export function fromDbType(t: string): Service {
  return t.toLowerCase() as Service;
}
