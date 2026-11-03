import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/prisma";
import { isAdminEmail } from "@/lib/admins";

export const dynamic = "force-dynamic";

const Body = z.object({
  name: z.string().trim().min(1, "Enter your name.").max(60),
  email: z.string().trim().toLowerCase().email("Enter a valid email address.").max(120),
  password: z.string().min(1, "Enter a password.").max(200),
});

/**
 * POST /api/register — create a staff login.
 * The very first account, and any email listed in src/lib/admins.ts, becomes an admin; everyone else is staff.
 */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    const msg = parsed.error.issues[0]?.message ?? "Check the details and try again.";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
  const { name, email, password } = parsed.data;

  if (await prisma.user.findUnique({ where: { email } })) {
    return NextResponse.json({ error: "An account with this email already exists. Sign in instead." }, { status: 409 });
  }

  const isAdmin = (await prisma.user.count()) === 0 || isAdminEmail(email);
  const passwordHash = await bcrypt.hash(password, 12);
  await prisma.user.create({
    data: { name, email, passwordHash, role: isAdmin ? "ADMIN" : "STAFF" },
  });
  return NextResponse.json({ ok: true, admin: isAdmin }, { status: 201 });
}
