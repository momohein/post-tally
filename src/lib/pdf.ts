import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { PostDTO } from "./posts";
import { groupByCompany } from "./companies";
import { bagName, groupByBag } from "./bagNames";

/** Page sizes in PDF points (1 mm = 2.8346 pt). "label" is a 100 × 150 mm (4 × 6 in) thermal label. */
export const PAGE_SIZES = {
  label: { width: 283.46, height: 425.2, margin: 12 },
  a4: { width: 595.28, height: 841.89, margin: 40 },
} as const;
export type PageSize = keyof typeof PAGE_SIZES;

type Fonts = { regular: PDFFont; bold: PDFFont; mono: PDFFont };

const BLACK = rgb(0, 0, 0); // thermal printers print black only, so no greys

/** Standard PDF fonts only cover Western European characters; swap anything else for a close match or "?". */
function safe(font: PDFFont, text: string): string {
  let out = "";
  for (const ch of text.normalize("NFC")) {
    try {
      font.encodeText(ch);
      out += ch;
    } catch {
      const plain = ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
      try {
        font.encodeText(plain);
        out += plain;
      } catch {
        out += "?";
      }
    }
  }
  return out;
}

/** Split text into lines that fit `width`, breaking long words if needed. */
function wrap(font: PDFFont, size: number, text: string, width: number): string[] {
  const lines: string[] = [];
  for (const para of text.split("\n").map((p) => safe(font, p))) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= width) {
        line = next;
        continue;
      }
      if (line) lines.push(line);
      line = word;
      while (font.widthOfTextAtSize(line, size) > width && line.length > 1) {
        let cut = line.length - 1;
        while (cut > 1 && font.widthOfTextAtSize(line.slice(0, cut), size) > width) cut--;
        lines.push(line.slice(0, cut));
        line = line.slice(cut);
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

export type PdfInput = {
  office: string; // e.g. "Ringsend P.O."
  dayLabel: string; // e.g. "Tue 20 Oct 2026"
  printedAt: string; // e.g. "20/10/2026, 20:40"
  time: (iso: string) => string;
  rows: PostDTO[];
  size: PageSize;
};

export async function buildPdf({ office, dayLabel, printedAt, time, rows, size }: PdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Post Tally ${office} ${dayLabel}`);
  doc.setCreator("Post Tally");
  const f: Fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    mono: await doc.embedFont(StandardFonts.CourierBold),
  };
  const { width, height, margin } = PAGE_SIZES[size];
  const big = size === "a4";
  const s = {
    title: big ? 18 : 13,
    body: big ? 10 : 8.5,
    small: big ? 8 : 7,
    track: big ? 12 : 10.5,
  };
  const inner = width - margin * 2;
  // Indent for the item number column, wide enough for "999."
  const indent = f.bold.widthOfTextAtSize("999.", big ? 10 : 8.5) + 6;
  const bottom = margin + s.small + 6; // keep room for the page footer

  const totals = { registered: 0, express: 0, parcel: 0 };
  rows.forEach((r) => totals[r.type]++);

  const pages: PDFPage[] = [];
  let page!: PDFPage;
  let y = 0;

  const text = (str: string, x: number, font: PDFFont, size: number) =>
    page.drawText(safe(font, str), { x, y, size, font, color: BLACK });
  const rule = (thickness = 0.6) =>
    page.drawLine({ start: { x: margin, y }, end: { x: width - margin, y }, thickness, color: BLACK });

  function newPage(first: boolean) {
    page = doc.addPage([width, height]);
    pages.push(page);
    y = height - margin - s.title;
    if (first) {
      text(office, margin, f.bold, s.title);
      y -= s.body + 4;
      text(`Posts recorded ${dayLabel}`, margin, f.regular, s.body);
      y -= s.body + 6;
      const line = `Registered ${totals.registered}   Express ${totals.express}   Parcel ${totals.parcel}`;
      text(line, margin, f.bold, s.body);
      y -= s.body + 3;
      text(`Total ${rows.length} item${rows.length === 1 ? "" : "s"}`, margin, f.bold, s.body);
      const bags = groupByBag(rows);
      if (bags.length) {
        const bagLine = bags.map((g) => `${bagName(g.type, g.bag)}: ${g.rows.length}`).join("   ");
        for (const line of wrap(f.regular, s.small, bagLine, inner)) {
          y -= s.small + 4;
          text(line, margin, f.regular, s.small);
        }
      }
      y -= 6;
      rule(1.2);
      y -= s.track + 4;
    } else {
      y = height - margin - s.small;
      text(`${office} · ${dayLabel} (continued)`, margin, f.bold, s.small);
      y -= 5;
      rule();
      y -= s.track + 4;
    }
  }

  newPage(true);

  /** Start a new page if the next `h` points won't fit above the footer. */
  const ensure = (h: number) => {
    if (y - h + s.track < bottom) newPage(false);
  };
  const heading = (label: string) => {
    ensure(s.small + 10 + s.track);
    text(label.toUpperCase(), margin, f.bold, s.small);
    y -= s.track + 6;
  };

  if (rows.length === 0) {
    text("Nothing was recorded on this day.", margin, f.regular, s.body);
  }

  const trackW = f.mono.widthOfTextAtSize("RL000000000IE", s.track);
  const gap = big ? 18 : 10;
  const cols = Math.max(1, Math.floor((inner - indent + gap) / (trackW + gap)));

  // ---- One section per bag: Registered bag 1, 2 ... then Express bag 1, 2 ... then Parcel
  for (const group of groupByBag(rows)) {
    const bagTitle = `${bagName(group.type, group.bag)} — ${group.rows.length} item${group.rows.length === 1 ? "" : "s"}`;
    ensure(s.body + s.track + 14);
    page.drawRectangle({ x: margin, y: y - 4, width: inner, height: s.body + 8, color: BLACK });
    page.drawText(safe(f.bold, bagTitle.toUpperCase()), { x: margin + 4, y, size: s.body, font: f.bold, color: rgb(1, 1, 1) });
    y -= s.track + 10;

    // Company lists in this bag: one block per company with its count and every tracking number
    const companies = groupByCompany(group.rows);
    const singles = group.rows.filter((r) => !r.listId);
    if (companies.length && singles.length) heading("Company lists");
    for (const c of companies) {
      const nameLines = wrap(f.bold, s.body, c.name, inner - 70);
      const countText = `${c.count} ${c.type}`;
      ensure(nameLines.length * (s.body + 3) + s.track + 10);
      nameLines.forEach((line, n) => {
        text(line, margin, f.bold, s.body);
        if (n === 0) {
          page.drawText(countText, {
            x: width - margin - f.bold.widthOfTextAtSize(countText, s.body),
            y,
            size: s.body,
            font: f.bold,
            color: BLACK,
          });
        }
        y -= s.body + 3;
      });
      y -= 3;
      for (let i = 0; i < c.tracking.length; i += cols) {
        ensure(s.track + 4);
        c.tracking.slice(i, i + cols).forEach((t, k) => {
          page.drawText(safe(f.mono, t), { x: margin + indent + k * (trackW + gap), y, size: s.track, font: f.mono, color: BLACK });
        });
        // running count at the left so the list can be checked against the sheet
        text(`${i + 1}.`, margin, f.regular, s.small);
        y -= s.track + 4;
      }
      y -= 2;
      rule(0.4);
      y -= s.track + 4;
    }

    // Single items in this bag (photographed or typed in one at a time)
    if (singles.length && companies.length) heading("Single items");
    singles.forEach((r, i) => {
      const addrLines = r.address ? wrap(f.regular, s.body, r.address, inner - indent) : [];
      const meta = [time(r.scannedAt), r.scannedBy].filter(Boolean).join(" · ");
      const metaLines = wrap(f.regular, s.small, meta, inner - indent);
      ensure(s.track + 4 + addrLines.length * (s.body + 3) + metaLines.length * (s.small + 3) + 8);

      text(`${i + 1}.`, margin, f.bold, s.body);
      text(r.trackingNumber ?? "No tracking number", margin + indent, f.mono, s.track);
      y -= 2;
      for (const line of addrLines) {
        y -= s.body + 3;
        text(line, margin + indent, f.regular, s.body);
      }
      for (const line of metaLines) {
        y -= s.small + 3;
        text(line, margin + indent, f.regular, s.small);
      }
      y -= 6;
      rule(0.4);
      y -= s.track + 4;
    });
    y -= 4;
  }

  // Footer on every page: printed time and page numbers
  pages.forEach((p, n) => {
    const footer = `Printed ${printedAt}   Page ${n + 1} of ${pages.length}`;
    p.drawText(safe(f.regular, footer), { x: margin, y: margin, size: s.small, font: f.regular, color: BLACK });
  });

  return doc.save();
}
