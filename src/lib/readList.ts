import { z } from "zod";
import { classify, cleanTracking, isS10, s10CheckOk, SERVICES, type Service } from "./classify";
import { getClient, parseJson, LabelReadError } from "./readLabel";

const PROMPT = `This is a photo of a post office posting list, such as An Post's "Registered post – Certificate of posting"
or "Express post – Certificate of posting". A company hands in several registered or express items with it. Each item has its own numbered row with a tracking number
sticker in the "Item number" column (e.g. "RL 0637 9041 5IE"). The number of filled rows varies from page to page
(it may be 3, 6, 7, 10 ...); the remaining rows are left empty.

Your most important job is to COUNT THE TRACKING STICKERS CORRECTLY and read each tracking number exactly.
Reading the recipient's handwritten name and address is secondary: if it is hard to read, return null for it.

Reply with ONLY a JSON object, no other text:
{"sender": string or null,
 "service": "registered" | "express" | "parcel" | "unknown",
 "sheet_total": number or null,
 "items": [{"line": number, "tracking_number": string or null, "name": string or null, "address": string or null}]}

Rules:
- items: exactly one entry per row that has a tracking number sticker (or a printed/written tracking number), in row order.
  Do NOT include rows without a tracking number, even if something is handwritten there. Do not skip any row that has a sticker.
- line: the printed row number (1, 2, 3 ...).
- tracking_number: copy it exactly with no spaces: 2 letters + 9 digits + 2 letters (e.g. RL063790415IE). Read every digit carefully.
  If a row clearly has a sticker but you cannot read it, still include the row with tracking_number null.
- name / address: the recipient written beside that sticker, address lines separated by \\n. null if unclear; never guess.
- sender: the customer (sender) name and address box at the top of the sheet, lines separated by \\n. null if empty.
- service: which service the sheet is for, from its printed title (e.g. "Registered post", "Express post") or ticked boxes. "unknown" if not shown.
- sheet_total: the number written in the "Total items on this list" box, or null if it is empty.
- Ignore the payment, value, weight, amount and stamp boxes.`;

const Reply = z.object({
  sender: z.string().nullable().optional(),
  sheet_total: z.union([z.number(), z.string()]).nullable().optional(),
  service: z.string().nullable().optional(),
  items: z
    .array(
      z.object({
        line: z.union([z.number(), z.string()]).nullable().optional(),
        tracking_number: z.string().nullable().optional(),
        name: z.string().nullable().optional(),
        address: z.string().nullable().optional(),
      }),
    )
    .default([]),
});

export type ListLine = {
  line: number;
  trackingNumber: string;
  address: string; // name on the first line, then the address
  problem: string | null; // why this line needs checking, or null if it looks right
};

export type ListReading = {
  sender: string;
  items: ListLine[];
  /** The "Total items on this list" box, when filled in. */
  sheetTotal: number | null;
  /** The list's service: from the sheet's title, else from most tracking prefixes, else registered. */
  service: Service;
};

export function lineProblem(trackingNumber: string): string | null {
  if (!trackingNumber) return "Couldn't read this tracking number. Type it from the sheet.";
  if (!isS10(trackingNumber)) return "Tracking number doesn't look complete.";
  if (!s10CheckOk(trackingNumber)) return "Check digit doesn't match — a digit may be misread.";
  return null;
}

export async function readList(
  imageBase64: string,
  mediaType: "image/jpeg" | "image/png" | "image/webp",
): Promise<ListReading> {
  const message = await getClient().messages.create({
    // Handwriting on a full sheet needs a stronger model than a single label.
    model: process.env.CLAUDE_LIST_MODEL || "claude-sonnet-5-5",
    max_tokens: 4000,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: imageBase64 } },
          { type: "text", text: PROMPT },
        ],
      },
    ],
  });

  const text = message.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  const parsed = Reply.safeParse(parseJson(text));
  if (!parsed.success) throw new LabelReadError("The list couldn't be read clearly. Try a sharper, straight-on photo.");

  const items: ListLine[] = parsed.data.items
    .map((it, i) => {
      const trackingNumber = cleanTracking(it.tracking_number);
      const address = [it.name, it.address]
        .map((s) => (s ?? "").trim())
        .filter(Boolean)
        .join("\n");
      const line = Number(it.line) > 0 ? Number(it.line) : i + 1;
      return { line, trackingNumber, address, problem: lineProblem(trackingNumber) };
    })
    // Each tracking number counts once, even if the model listed it twice.
    .filter((it, i, all) => !it.trackingNumber || all.findIndex((x) => x.trackingNumber === it.trackingNumber) === i);

  if (items.length === 0) throw new LabelReadError("No tracking numbers were found on this list. Try a sharper photo of the whole page.");
  const total = Number(parsed.data.sheet_total);
  const sheetTotal = Number.isInteger(total) && total > 0 && total < 1000 ? total : null;
  const fromSheet = SERVICES.find((x) => x === parsed.data.service);
  const votes = { registered: 0, express: 0, parcel: 0 };
  items.forEach((it) => {
    const c = classify(it.trackingNumber);
    if (c) votes[c]++;
  });
  const fromPrefixes = SERVICES.reduce<Service | null>((best, x) => (votes[x] > (best ? votes[best] : 0) ? x : best), null);
  const service: Service = fromSheet ?? fromPrefixes ?? "registered";
  return { sender: (parsed.data.sender ?? "").trim(), items, sheetTotal, service };
}
