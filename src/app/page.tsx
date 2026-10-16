import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { dayOf } from "@/lib/day";
import Tally from "@/components/Tally";

export const dynamic = "force-dynamic";

export default async function Home() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) redirect("/login");
  return (
    <Tally
      today={dayOf()}
      user={{ id: session.user.id, name: session.user.name ?? "", role: session.user.role }}
    />
  );
}
