import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { classify, cleanTracking, SERVICES, type Service } from "./classify";

const PROMPT = `This is a photo of one postal item (letter, envelope or parcel) at an An Post counter.
The photo may be sideways or upside down; read the labels in whatever direction they face.
Read the item and call the record_label tool.

- tracking_number: the tracking number printed beside the barcode, e.g. "LL 2766 4606 9IE" or "RR123456789IE":
  2 letters + 9 digits + 2-letter country code. Copy it exactly with no spaces. Empty string if none is visible.
- service: from the label or the tracking number's first letter:
  R = "registered"; E or L = "express" (red An Post "ExpressPost" labels start with LL); C or V = "parcel".
  Use "unknown" if you can't tell.
- address: the DELIVERY (recipient, "To:") address only, never the sender ("From:"), as written,
  one line per address line. Empty string if it can't be read.`;

/** Forcing a tool call makes the model return structured data instead of free text. */
const TOOL = {
  name: "record_label",
  description: "Record the tracking number, service and delivery address read from one postal item.",
  input_schema: {
    type: "object" as const,
    properties: {
      tracking_number: { type: "string", description: "Tracking number with no spaces, or empty string." },
      service: { type: "string", enum: ["registered", "express", "parcel", "unknown"] },
      address: { type: "string", description: "Recipient address, one line per address line, or empty string." },
    },
    required: ["tracking_number", "service", "address"],
  },
};

/** Text, an array of lines, or nothing -> one string (models sometimes return addresses as arrays). */
export const looseText = z.preprocess(
  (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string").join("\n") : v),
  z.string().nullable().optional(),
);

const Reply = z.object({
  tracking_number: looseText,
  service: looseText,
  address: looseText,
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

/**
 * Parse the first {...} block in text. Tolerates raw line breaks inside strings
 * (a multi-line address written out literally), which plain JSON.parse rejects.
 */
export function parseJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  const raw = text.slice(start, end + 1);
  try {
    return JSON.parse(raw);
  } catch {
    let out = "";
    let inString = false;
    let escaped = false;
    for (const ch of raw) {
      if (inString && !escaped && (ch === "\n" || ch === "\r" || ch === "\t")) {
        out += ch === "\n" ? "\\n" : ch === "\t" ? "\\t" : "";
        continue;
      }
      if (ch === '"' && !escaped) inString = !inString;
      escaped = ch === "\\" && !escaped;
      out += ch;
    }
    try {
      return JSON.parse(out);
    } catch {
      return null;
    }
  }
}

/** The structured result: the forced tool call's input, or JSON found in any text as a fallback. */
export function resultOf(message: Anthropic.Message, toolName: string): unknown {
  const call = message.content.find((b) => b.type === "tool_use" && b.name === toolName);
  if (call && call.type === "tool_use") return call.input;
  const text = message.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  return parseJson(text);
}

export async function readLabel(
  imageBase64: string,
  mediaType: "image/jpeg" | "image/png" | "image/webp",
): Promise<LabelReading> {
  const message = await getClient().messages.create({
    model: process.env.CLAUDE_MODEL || "claude-haiku-5-5",
    max_tokens: 800,
    tools: [TOOL],
    tool_choice: { type: "tool", name: TOOL.name },
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

  const parsed = Reply.safeParse(resultOf(message, TOOL.name));
  if (!parsed.success) {
    console.error("read-label: unexpected reply", JSON.stringify(message.content).slice(0, 1500));
    throw new LabelReadError("The label couldn't be read clearly. Try a sharper photo.");
  }

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
