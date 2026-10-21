// Make an existing account an admin (or staff again with --staff), and list who is admin.
//   npm run make-admin -- --email jj@example.com   (or just: npm run make-admin jj@example.com)
//   npm run make-admin -- --list
// Against the online database:
//   DATABASE_URL="your-neon-string" npm run make-admin -- --email jj@example.com
import { PrismaClient } from "@prisma/client";

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

const prisma = new PrismaClient();

// Say which database this is, so it's clear whether it's the one on this Mac or the online one.
const host = (process.env.DATABASE_URL ?? "").match(/@([^/:?]+)/)?.[1] ?? "unknown";
console.log(
  host === "localhost" || host === "127.0.0.1"
    ? "Using the database ON THIS MAC. For the online app, put DATABASE_URL=\"your-neon-string\" in front of the command."
    : `Using the ONLINE database (${host.split(".")[0]}).`,
);
try {
  if (process.argv.includes("--list")) {
    const users = await prisma.user.findMany({ orderBy: { createdAt: "asc" }, select: { name: true, email: true, role: true } });
    if (users.length === 0) console.log("No accounts yet.");
    for (const u of users) console.log(`${u.role === "ADMIN" ? "ADMIN" : "staff"}  ${u.name} <${u.email}>`);
  } else {
    // Accept "--email x@y.ie", "-- email x@y.ie" or just "x@y.ie": any word with an @ is the email.
    const email = (arg("email") ?? process.argv.slice(2).find((w) => w.includes("@")))?.trim().toLowerCase().replace(/^-+/, "");
    if (!email) {
      console.error('Usage: npm run make-admin -- --email name@example.com   (or --list to see everyone)');
      process.exit(1);
    }
    const role = process.argv.includes("--staff") ? "STAFF" : "ADMIN";
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      console.error(`No account with the email ${email}. Run with --list to see the accounts.`);
      process.exit(1);
    }
    await prisma.user.update({ where: { email }, data: { role } });
    console.log(`${user.name} <${email}> is now ${role === "ADMIN" ? "an admin" : "staff"}. Sign out and back in to see the change.`);
  }
} finally {
  await prisma.$disconnect();
}
