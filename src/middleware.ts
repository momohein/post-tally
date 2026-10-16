import { withAuth } from "next-auth/middleware";

// Everything except the login page, auth endpoints and install files needs a signed-in user.
export default withAuth({ pages: { signIn: "/login" } });

export const config = {
  matcher: ["/((?!login|api/auth|_next/static|_next/image|icons|manifest.webmanifest|favicon.ico).*)"],
};
