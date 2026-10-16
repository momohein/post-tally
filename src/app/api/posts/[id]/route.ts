import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { currentUser } from "@/lib/auth";

/** DELETE /api/posts/:id — the person who scanned it, or an admin, can remove a record. */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const post = await prisma.post.findUnique({ where: { id: params.id } });
  if (!post) return NextResponse.json({ error: "That record no longer exists." }, { status: 404 });
  if (post.scannedById !== user.id && user.role !== "ADMIN") {
    return NextResponse.json({ error: "Only the person who scanned it or an admin can delete this record." }, { status: 403 });
  }
  await prisma.post.delete({ where: { id: post.id } });
  return NextResponse.json({ ok: true });
}
