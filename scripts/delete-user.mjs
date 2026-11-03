// Delete an account so the person can sign up again with the same email.
//   npm run delete-user -- --email name@example.com            (shows what would happen, changes nothing)
//   npm run delete-user -- --email name@example.com --yes      (deletes it)
// If they scanned posts, lists or closed bags, those must stay, so move them to another account:
//   npm run delete-user -- --email name@example.com --move-to you@example.com --yes
// Against the online database:
//   DATABASE_URL="your-neon-string" npm run delete-user -- --email name@example.com --yes
import { PrismaClient } from "@prisma/client";

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1]?.trim().toLowerCase() : undefined;
}

const prisma = new PrismaClient();
const host = (process.env.DATABASE_URL ?? "").match(/@([^/:?]+)/)?.[1] ?? "unknown";
console.log(
  host === "localhost" || host === "127.0.0.1"
    ? "Using the database ON THIS MAC. For the online app, put DATABASE_URL=\"your-neon-string\" in front of the command."
    : `Using the ONLINE database (${host.split(".")[0]}).`,
);

try {
  const email = arg("email");
  const moveTo = arg("move-to");
  const confirmed = process.argv.includes("--yes");
  if (!email) {
    console.error("Usage: npm run delete-user -- --email name@example.com [--move-to you@example.com] --yes");
    process.exit(1);
  }
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`No account with the email ${email}. Run "npm run make-admin -- --list" to see the accounts.`);
    process.exit(1);
  }
  const [posts, lists, bags] = await Promise.all([
    prisma.post.count({ where: { scannedById: user.id } }),
    prisma.postingList.count({ where: { scannedById: user.id } }),
    prisma.bagClose.count({ where: { closedById: user.id } }),
  ]);
  const hasRecords = posts + lists + bags > 0;
  console.log(`${user.name} <${email}> (${user.role}) has ${posts} posts, ${lists} company lists and ${bags} closed bags.`);

  let target = null;
  if (hasRecords) {
    if (!moveTo) {
      console.error("Those records can't be deleted. Add --move-to <another account's email> to move them first.");
      process.exit(1);
    }
    target = await prisma.user.findUnique({ where: { email: moveTo } });
    if (!target || target.id === user.id) {
      console.error(`No other account with the email ${moveTo}.`);
      process.exit(1);
    }
  }
  if (!confirmed) {
    console.log(
      `Nothing changed yet. Add --yes to delete this account${target ? ` and move its records to ${target.name} <${moveTo}>` : ""}. This can't be undone.`,
    );
    process.exit(0);
  }
  await prisma.$transaction([
    ...(target
      ? [
          prisma.post.updateMany({ where: { scannedById: user.id }, data: { scannedById: target.id } }),
          prisma.postingList.updateMany({ where: { scannedById: user.id }, data: { scannedById: target.id } }),
          prisma.bagClose.updateMany({ where: { closedById: user.id }, data: { closedById: target.id } }),
        ]
      : []),
    prisma.user.delete({ where: { id: user.id } }),
  ]);
  console.log(`Deleted ${user.name} <${email}>.${target ? ` Records moved to ${target.name}.` : ""} They can sign up again now.`);
} finally {
  await prisma.$disconnect();
}
