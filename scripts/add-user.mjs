// Create or update a staff login.
//   npm run add-user -- --email teresa@example.com --name "Teresa" --password "a-long-password" --admin
// Inside Docker:
//   docker compose exec app node scripts/add-user.mjs --email ... --name ... --password ...
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
}

const email = arg("email")?.trim().toLowerCase();
const name = arg("name")?.trim();
const password = arg("password");
const role = process.argv.includes("--admin") ? "ADMIN" : "STAFF";

if (!email || !name || !password) {
  console.error('Usage: npm run add-user -- --email you@example.com --name "Your Name" --password "secret" [--admin]');
  process.exit(1);
}

const prisma = new PrismaClient();
try {
  const passwordHash = await bcrypt.hash(password, 12);
  const user = await prisma.user.upsert({
    where: { email },
    update: { name, passwordHash, role },
    create: { email, name, passwordHash, role },
  });
  console.log(`Saved ${user.role.toLowerCase()} login for ${user.name} <${user.email}>.`);
} finally {
  await prisma.$disconnect();
}
