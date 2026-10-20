import { withAuth } from "next-auth/middleware";

// Everything except the login and sign-up pages, auth endpoints and install files needs a signed-in user.
export default withAuth({ pages: { signIn: "/login" } });

export const config = {
  matcher: ["/((?!login|register|api/auth|api/register|api/cron|_next/static|_next/image|icons|manifest.webmanifest|favicon.ico).*)"],
};
