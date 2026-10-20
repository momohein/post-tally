# Post Tally

A phone web app for a post office counter. Staff photograph a postal item's label; the app reads the
tracking number, service and delivery address, then keeps a daily count of **registered**, **express**
and **parcel** posts.

**Stack:** Next.js 14 (App Router) · Prisma · PostgreSQL in Docker · Auth.js (NextAuth) staff logins ·
Claude API for reading labels.

```
Phone (browser / home-screen app)
   │  photo, resized to 1600px on the phone
   ▼
Next.js server ── /api/read-label ──► Claude API (vision)  → tracking no., service, address
   │                                                         (photo is never stored)
   ├── /api/posts      save / list a day's records
   ├── /api/posts/:id  delete a record
   ├── /api/read-list  read a whole posting list photo ──► Claude API
   ├── /api/lists      save a posting list (all items at once)
   ├── /api/lists/:id  delete a posting list
   ├── /api/posts/export  CSV for a day
   └── /api/posts/export/pdf  printable PDF for a day (100×150 mm label or A4)
   ▼
PostgreSQL (Docker)  ── User, Post, PostingList tables
```

### Two post offices

The app is shared by **Ringsend P.O.** and **Ballsbridge P.O.** The first time it's opened on a phone or iPad it
asks which office it's at and remembers that on the device (tap **Change** under the title to switch). Every
record and company list is saved under that office, and the totals, log, PDF and CSV show one office at a time.
Staff accounts work at both offices. Tracking numbers are unique across both, so an item can't be counted at
both branches. To add a branch, add it to `src/lib/offices.ts`.

### Daily report by email

Every morning the app emails **all admin accounts** the previous day's report: a summary of both offices
in the message and one PDF per office attached (label size by default; set `REPORT_PDF_SIZE=a4` for A4).
Add more people with `REPORT_EMAIL` (comma-separated). Admins also see an **Email report** button to send
the selected day's report straight away.

Setup (Gmail): turn on 2-Step Verification for the Google account, create an App Password at
https://myaccount.google.com/apppasswords, then set `SMTP_USER` (the Gmail address) and `SMTP_PASS`
(the 16-letter app password, no spaces). On Vercel also set `CRON_SECRET`; `vercel.json` runs
`/api/cron/daily-report` at 05:00 UTC every day. On a Docker server, call it from cron instead:

```
0 5 * * * curl -s -H "Authorization: Bearer $CRON_SECRET" https://your-domain/api/cron/daily-report
```

Records are never deleted at the end of a day: each day simply starts from 0, and any earlier day can be
viewed, printed or emailed again by choosing it in **Day**.

### Printing the day's log

**Print PDF (label)** opens a PDF sized 100 × 150 mm (4 × 6 in) for thermal label printers such as LabelLife.
Long days continue onto more labels. In the print dialog choose the printer's 100 × 150 mm / 4 × 6 in paper
and **Actual size / 100 %** scale (not "Fit"). **A4** gives the same log on normal paper; **CSV** is for spreadsheets.
For a different label size, edit `PAGE_SIZES` in `src/lib/pdf.ts`.

### Company posting lists

Businesses often hand in many registered items with one **Certificate of posting** sheet (a numbered list of
tracking stickers with handwritten names and addresses). Tap **Take photo of a company list**, photograph the whole
sheet, and the app reads every line. Staff check the count and each tracking number against the sheet, fix
anything flagged, and save all the items in one go. They count as registered posts in the day's totals, and
the log shows the list under the sender's name. A whole list can be deleted at once if it was saved by mistake.

Each tracking number's S10 check digit is verified, so most misread digits are flagged before saving.
Items already recorded (or listed twice) are blocked so nothing is counted twice.

The service comes from the tracking number's UPU S10 prefix (R = registered, E = express,
C/V = parcel) in `src/lib/classify.ts`. Check which prefixes your post office's domestic labels use
and adjust that file if needed.

---

## 1. Run it on your laptop

You need **Node.js 20+** and **Docker Desktop**.

```bash
npm install
cp .env.example .env          # then edit .env (see below)
docker compose up -d db       # starts PostgreSQL only
npx prisma migrate deploy     # creates the tables
npm run add-user -- --email you@example.com --name "Momo" --password "your-password" --admin
npm run dev                   # http://localhost:3000
```

In `.env`, set at least:

| Variable | What to put |
|---|---|
| `POSTGRES_PASSWORD` | Any strong password. Use the same one inside `DATABASE_URL`. |
| `NEXTAUTH_SECRET` | Output of `openssl rand -base64 32` |
| `ANTHROPIC_API_KEY` | A key from console.anthropic.com. Without it, staff can still type items in by hand. |

### Try it from your phone on the same Wi-Fi

Find your laptop's local IP (e.g. `192.168.1.20`), set `NEXTAUTH_URL=http://192.168.1.20:3000`,
restart `npm run dev`, and open that address on your phone. Photo upload works over plain HTTP;
installing to the home screen needs HTTPS (step 2).

---

## 2. Put it online (Docker on a server)

On any Linux server with Docker (e.g. a small VPS):

```bash
git clone <your repo> post-tally && cd post-tally
cp .env.example .env          # set real values; NEXTAUTH_URL=https://your-domain
docker compose up -d --build  # builds the app, starts db + app, applies migrations
docker compose exec app node scripts/add-user.mjs --email you@example.com --name "Momo" --password "..." --admin
```

The app listens on port 3000. Put HTTPS in front of it, for example with Caddy:

```
your-domain.com {
    reverse_proxy localhost:3000
}
```

Then on the phone: open `https://your-domain.com` → **Share → Add to Home Screen** (iPhone) or
**⋮ → Install app** (Android).

**Backups:** the database lives in the `pgdata` Docker volume. A daily dump:

```bash
docker compose exec db pg_dump -U posttally posttally > backup-$(date +%F).sql
```

---

## 3. Staff logins

Only people with a login can open the app. Every record shows the name of the person who scanned it.

**Sign-up page:** coworkers open `/register` (or tap **Create an account** on the login screen), enter their
name, email and a password, and are signed straight in. The very first account created on a fresh database
becomes the admin. Anyone who has the app's address can sign up, so share the link only with staff.

**Or add someone yourself:**

```bash
npm run add-user -- --email name@example.com --name "Name" --password "their-password"
# or on the server:
docker compose exec app node scripts/add-user.mjs --email ... --name ... --password ...
```

Add `--admin` for someone who may delete anyone's records. Staff can delete only their own.

---

## 4. Useful commands

| Command | Does |
|---|---|
| `npm run dev` | Development server with hot reload |
| `npm test` | Tests for the tracking-number rules |
| `npm run typecheck` | TypeScript check |
| `npx prisma migrate dev --name <change>` | After editing `prisma/schema.prisma`, creates a new migration |
| `npx prisma studio` | Browse the database in your browser |

---

## Privacy

Delivery addresses are personal data under GDPR. Get your manager's approval before using this on
real customer mail, keep the server and logins secure, and consider deleting old records on a
schedule. Photos are sent to the Claude API to be read and are not stored by this app.
