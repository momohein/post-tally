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

/** Turn an Anthropic API failure into a message staff and admins can act on. */
export function apiProblem(e: unknown, model: string): LabelReadError | null {
  // Checked by name and status rather than instanceof, which can miss when two copies of the SDK are loaded.
  const err = e as { name?: string; status?: unknown; message?: unknown } | null;
  const name = err?.name ?? "";
  if (name === "APIConnectionTimeoutError") return new LabelReadError("Reading took too long. Try again.", 504);
  if (name === "APIConnectionError") return new LabelReadError("The server couldn't reach the label reader. Try again.", 502);
  const status = typeof err?.status === "number" ? err.status : undefined;
  if (status === undefined) return null;
  const msg = String(err?.message ?? "").toLowerCase();
  switch (status) {
    case 401:
      return new LabelReadError("Label reading is off: the ANTHROPIC_API_KEY setting isn't valid. An admin needs to update it in Vercel.", 503);
    case 403:
      return new LabelReadError("The ANTHROPIC_API_KEY isn't allowed to read photos. Check the key in console.anthropic.com.", 503);
    case 404:
      return new LabelReadError(`The reading model "${model}" wasn't found. Check the CLAUDE_MODEL setting.`, 503);
    case 413:
      return new LabelReadError("That photo is too large. Try again.", 413);
    case 400:
      if (msg.includes("credit")) return new LabelReadError("The Anthropic account is out of credit. Add credit at console.anthropic.com.", 503);
      if (msg.includes("image")) return new LabelReadError("That photo couldn't be opened. Take it again.", 400);
      return new LabelReadError(`The label reader refused the request (${String(err?.message).slice(0, 120)}).`, 502);
    case 429:
    case 529:
      return new LabelReadError("The label reader is busy. Try again in a moment.", 503);
    default:
      return status >= 500 ? new LabelReadError("The label reader had a problem. Try again in a moment.", 502) : null;
  }
}

let client: Anthropic | null = null;
export function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new LabelReadError("Label reading isn't set up on this server. Type the details in.", 503);
  }
  // Trim stray spaces or quotes pasted around the key in the hosting settings.
  const apiKey = process.env.ANTHROPIC_API_KEY.trim().replace(/^["']+|["']+$/g, "");
  client ??= new Anthropic({ apiKey, maxRetries: 2, timeout: 45_000 });
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

const FAST_MODEL = () => process.env.CLAUDE_MODEL || "claude-haiku-5-5";
/** Stronger model used for a second try when the fast one can't find the tracking number. */
const STRONG_MODEL = () => process.env.CLAUDE_LIST_MODEL || "claude-sonnet-5-5";

async function readWith(model: string, imageBase64: string, mediaType: "image/jpeg" | "image/png" | "image/webp") {
  let message: Anthropic.Message;
  try {
    message = await getClient().messages.create({
      model,
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
  } catch (e) {
    throw apiProblem(e, model) ?? e;
  }
  const parsed = Reply.safeParse(resultOf(message, TOOL.name));
  if (!parsed.success) {
    console.error(`read-label (${model}): unexpected reply`, JSON.stringify(message.content).slice(0, 1500));
    return null;
  }
  return parsed.data;
}

export async function readLabel(
  imageBase64: string,
  mediaType: "image/jpeg" | "image/png" | "image/webp",
): Promise<LabelReading> {
  // Fast model first; if it misses the tracking number (blurry, sideways, messy), try the stronger model once.
  let data = await readWith(FAST_MODEL(), imageBase64, mediaType);
  if (!data || !classify(data.tracking_number)) {
    try {
      const second = await readWith(STRONG_MODEL(), imageBase64, mediaType);
      if (second && (cleanTracking(second.tracking_number) || !data)) data = second;
    } catch (e) {
      if (!data) throw e;
    }
  }
  if (!data) throw new LabelReadError("The label couldn't be read. Type the tracking number in.");

  const trackingNumber = cleanTracking(data.tracking_number);
  const address = (data.address ?? "").trim();
  // The tracking-number rule wins; fall back to what the model saw on the label.
  const modelService = SERVICES.find((s) => s === data.service) ?? null;
  const type = classify(trackingNumber) ?? modelService;

  const missing: string[] = [];
  if (!trackingNumber) missing.push("tracking number");
  if (!type) missing.push("service");

  return { trackingNumber, type, address, missing };
}
