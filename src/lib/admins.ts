/**
 * Emails that always become admin when they sign up (on top of the very first account).
 * Add more here, or set ADMIN_EMAILS (comma-separated) in the environment.
 */
const BUILT_IN = (process.env.ADMIN_EMAILS ?? "").split(",").map((e) => e.trim()).filter(Boolean);

export function isAdminEmail(email: string): boolean {
  const extra = (process.env.ADMIN_EMAILS ?? "").split(",");
  return [...BUILT_IN, ...extra].map((e) => e.trim().toLowerCase()).filter(Boolean).includes(email.trim().toLowerCase());
}
