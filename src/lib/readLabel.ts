import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { classify, cleanTracking, SERVICES, type Service } from "./classify";

const PROMPT = `This is a photo of one postal item (letter, envelope or parcel) at a post office counter.
Read its label and reply with ONLY a JSON object, no other text:
{"tracking_number": string or null, "service": "registered" | "express" | "parcel" | "unknown", "address": string or null}
Rules:
- tracking_number: the tracking/barcode number printed on the item, usually 2 letters + 9 digits + 2-letter country code (e.g. RR123456789IE). Copy it exactly with no spaces. null if none is visible.
- service: from the tracking number's first letter if present (R = registered, E = express, C or V = parcel); otherwise from words on the item ("Registered", "Express", "Parcel") or a large box. "unknown" if unclear.
- address: the DELIVERY (recipient) address only, not the sender's, lines separated by \\n. null if not readable.`;

const Reply = z.object({
  tracking_number: z.string().nullable().optional(),
  service: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
});

export type LabelReading = {
  trackingNumber: string;
  type: Service | null;
  address: string;
  missing: string[];
};

export class LabelReadError extends Error {
  constructor(message: string, public status = 502) {
    super(message);
  }
}

let client: Anthropic | null = null;
export function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new LabelReadError("Label reading isn't set up on this server. Type the details in.", 503);
  }
  client ??= new Anthropic(); // reads ANTHROPIC_API_KEY from the environment
  return client;
}

/** Pull the first {...} block out of the model's reply and parse it. */
export function parseJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new LabelReadError("The label couldn't be read clearly. Try a sharper photo.");
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new LabelReadError("The label couldn't be read clearly. Try a sharper photo.");
  }
}

export async function readLabel(
  imageBase64: string,
  mediaType: "image/jpeg" | "image/png" | "image/webp",
): Promise<LabelReading> {
  const message = await getClient().messages.create({
    model: process.env.CLAUDE_MODEL || "claude-haiku-5-5",
    max_tokens: 500,
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

  const text = message.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("");
  const parsed = Reply.safeParse(parseJson(text));
  if (!parsed.success) throw new LabelReadError("The label couldn't be read clearly. Try a sharper photo.");

  const trackingNumber = cleanTracking(parsed.data.tracking_number);
  const address = (parsed.data.address ?? "").trim();
  // The tracking-number rule wins; fall back to what the model saw on the label.
  const modelService = SERVICES.find((s) => s === parsed.data.service) ?? null;
  const type = classify(trackingNumber) ?? modelService;

  const missing: string[] = [];
  if (!trackingNumber) missing.push("tracking number");
  if (!address) missing.push("address");
  if (!type) missing.push("service");

  return { trackingNumber, type, address, missing };
}
