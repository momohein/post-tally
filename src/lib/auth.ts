import type { NextAuthOptions } from "next-auth";
import { getServerSession } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma";

export const authOptions: NextAuthOptions = {
  session: { strategy: "jwt", maxAge: 60 * 60 * 12 }, // one working day
  pages: { signIn: "/login" },
  providers: [
    CredentialsProvider({
      name: "Staff login",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email = credentials?.email?.trim().toLowerCase();
        const password = credentials?.password;
        if (!email || !password) return null;
        let user;
        try {
          user = await prisma.user.findUnique({ where: { email } });
        } catch (e) {
          // Shown on the login page, so a bad DATABASE_URL isn't mistaken for a wrong password.
          console.error("Login: database unreachable", e);
          throw new Error("DatabaseUnavailable");
        }
        if (!user) return null;
        const ok = await bcrypt.compare(password, user.passwordHash);
        if (!ok) return null;
        return { id: user.id, name: user.name, email: user.email, role: user.role };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = (user as { role?: "ADMIN" | "STAFF" }).role ?? "STAFF";
        token.roleAt = Date.now();
      } else if (token.id && Date.now() - ((token.roleAt as number) ?? 0) > 60_000) {
        // Re-check the role every minute, so someone made admin sees admin buttons without signing out.
        try {
          const u = await prisma.user.findUnique({ where: { id: token.id as string }, select: { role: true } });
          if (u) token.role = u.role;
          token.roleAt = Date.now();
        } catch {
          // Keep the old role if the database is briefly unreachable.
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as "ADMIN" | "STAFF";
      }
      return session;
    },
  },
};

/** The signed-in user for an API route, or null. */
export async function currentUser() {
  const session = await getServerSession(authOptions);
  return session?.user?.id ? session.user : null;
}
