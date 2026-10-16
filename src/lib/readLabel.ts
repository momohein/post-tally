import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { cleanTracking, trackingProblem } from "./classify";

// The service (registered / express / parcel) is chosen by staff before the photo,
// so the model only reads the tracking number and the delivery address.
const PROMPT = `This is a photo of one postal item (letter, envelope or parcel) at a post office counter.
Read its label and reply with ONLY a JSON object, no other text:
{"tracking_number": string or null, "address": string or null}
Rules:
- tracking_number: the tracking number printed beside or under the barcode. It is always two letters, nine digits, then two letters, often printed with spaces like "RL 7827 3725 8IE". The same number may be printed several times; read the clearest copy. Return it without spaces, e.g. "RL782737258IE". null if none is visible.
- address: the DELIVERY (recipient, "To:") address only, never the sender's. Copy it as written, lines separated by \\n. null if it can't be read.`;

const Reply = z.object({
  tracking_number: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
});

export type LabelReading = {
  trackingNumber: string;
  address: string;
  /** Null when the tracking number has the right format and passes the check digit. */
  trackingProblem: string | null;
};

export class LabelReadError extends Error {
  constructor(message: string, public status = 502) {
    super(message);
  }
}

let client: Anthropic | null = null;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new LabelReadError("Label reading isn't set up on this server. Type the details in.", 503);
  }
  client ??= new Anthropic(); // reads ANTHROPIC_API_KEY from the environment
  return client;
}

/** Pull the first {...} block out of the model's reply and parse it. */
function parseJson(text: string): unknown {
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

  const text = message.content.map((block) => (block.type === "text" ? block.text : "")).join("");
  const parsed = Reply.safeParse(parseJson(text));
  if (!parsed.success) throw new LabelReadError("The label couldn't be read clearly. Try a sharper photo.");

  const trackingNumber = cleanTracking(parsed.data.tracking_number);
  return {
    trackingNumber,
    address: (parsed.data.address ?? "").trim(),
    trackingProblem: trackingProblem(trackingNumber),
  };
}
