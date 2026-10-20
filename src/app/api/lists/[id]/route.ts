import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { currentUser } from "@/lib/auth";

/** DELETE /api/lists/:id — remove a whole posting list and its items (the person who scanned it, or an admin). */
export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const list = await prisma.postingList.findUnique({ where: { id: params.id } });
  if (!list) return NextResponse.json({ error: "That list no longer exists." }, { status: 404 });
  if (list.scannedById !== user.id && user.role !== "ADMIN") {
    return NextResponse.json({ error: "Only the person who scanned it or an admin can delete this list." }, { status: 403 });
  }
  await prisma.postingList.delete({ where: { id: list.id } }); // its posts go with it
  return NextResponse.json({ ok: true });
}
