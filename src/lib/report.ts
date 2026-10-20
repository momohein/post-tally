import nodemailer from "nodemailer";
import { prisma } from "./prisma";
import { OFFICES, type OfficeId } from "./offices";
import { PAGE_SIZES, type PageSize } from "./pdf";
import { dayLabelOf, officeDayPdf } from "./dayPdf";
import { groupByCompany, type CompanyGroup } from "./companies";

export class ReportError extends Error {
  constructor(message: string, public status = 500) {
    super(message);
  }
}

/** Everyone who should get the daily report: all admin accounts, plus any REPORT_EMAIL addresses. */
export async function recipients(): Promise<string[]> {
  const admins = await prisma.user.findMany({ where: { role: "ADMIN" }, select: { email: true } });
  const extra = (process.env.REPORT_EMAIL ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return [...new Set([...admins.map((a) => a.email.toLowerCase()), ...extra])];
}

function transport() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (!SMTP_USER || !SMTP_PASS) {
    throw new ReportError("Email isn't set up yet. Add SMTP_USER and SMTP_PASS to the settings.", 503);
  }
  const port = Number(SMTP_PORT || 465);
  return nodemailer.createTransport({
    host: SMTP_HOST || "smtp.gmail.com",
    port,
    secure: port === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });
}

/**
 * Email one day's report for one office, or for every office when `only` is not given: a short summary in the message and one PDF per office attached.
 * Returns who it went to and the totals.
 */
export async function sendDayReport(day: string, only?: OfficeId) {
  const to = await recipients();
  if (to.length === 0) throw new ReportError("There's no admin account to send the report to.", 400);

  const envSize = process.env.REPORT_PDF_SIZE ?? "label";
  const size: PageSize = envSize in PAGE_SIZES ? (envSize as PageSize) : "label";

  const offices: { id: OfficeId; name: string; registered: number; express: number; parcel: number; total: number; companies: CompanyGroup[] }[] = [];
  const attachments: { filename: string; content: Buffer; contentType: string }[] = [];
  for (const o of OFFICES.filter((x) => !only || x.id === only)) {
    const { rows, pdf, filename } = await officeDayPdf(o.id, day, size);
    const t = { registered: 0, express: 0, parcel: 0 };
    rows.forEach((r) => t[r.type]++);
    offices.push({ id: o.id, name: o.name, ...t, total: rows.length, companies: groupByCompany(rows) });
    attachments.push({ filename, content: Buffer.from(pdf), contentType: "application/pdf" });
  }

  const label = dayLabelOf(day);
  const title = only ? `${offices[0].name} – ${label}` : label;
  const lines = offices.flatMap((o) => [
    `${o.name}: ${o.total} item${o.total === 1 ? "" : "s"} (Registered ${o.registered}, Express ${o.express}, Parcel ${o.parcel})`,
    ...o.companies.map((c) => `   ${c.name}: ${c.count} ${c.type} (${c.tracking.join(", ")})`),
  ]);
  const attachedNote = only ? "The PDF is attached." : "The PDF for each office is attached.";
  const text = [`Post Tally report for ${title}`, "", ...lines, "", attachedNote, "", "Sent automatically by Post Tally."].join("\n");
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const html = `<p><b>Post Tally report for ${esc(title)}</b></p><ul>${lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul><p>${attachedNote}</p><p style="color:#666">Sent automatically by Post Tally.</p>`;

  const from = process.env.MAIL_FROM || `Post Tally <${process.env.SMTP_USER}>`;
  await transport().sendMail({ from, to, subject: `Post Tally report – ${title}`, text, html, attachments });
  return { day, to, offices };
}
