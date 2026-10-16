const TZ = process.env.APP_TIMEZONE || "Europe/Dublin";

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
