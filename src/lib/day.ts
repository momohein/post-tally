const FALLBACK_TZ = "Europe/Dublin";

/**
 * The app's time zone from APP_TIMEZONE, tidied (spaces or quotes pasted around it are removed).
 * An invalid value would make every date call throw, so it falls back to Europe/Dublin instead.
 */
function resolveTimeZone(): string {
  const raw = (process.env.APP_TIMEZONE ?? "").trim().replace(/^["']+|["']+$/g, "").trim();
  if (!raw) return FALLBACK_TZ;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: raw });
    return raw;
  } catch {
    console.error(`APP_TIMEZONE "${raw}" is not a valid time zone; using ${FALLBACK_TZ}.`);
    return FALLBACK_TZ;
  }
}

export const TZ = resolveTimeZone();

/** Calendar day (YYYY-MM-DD) of a moment in the app's time zone. */
export function dayOf(date: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function isDay(s: string | null): s is string {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
}
