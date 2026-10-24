import { googleRequest } from "./auth";

const base = "https://gmail.googleapis.com/gmail/v1/users/me";
export const optOutLine = "If you'd prefer no follow-ups, just let me know.";
export type GmailPart = {
  mimeType?: string;
  filename?: string;
  body?: { data?: string };
  parts?: GmailPart[];
  headers?: { name: string; value: string }[];
};
export type GmailMessage = {
  id: string;
  labelIds?: string[];
  internalDate?: string;
  payload?: GmailPart;
  snippet?: string;
};
type GmailThread = { messages?: GmailMessage[] };
const header = (message: GmailMessage, name: string) =>
  message.payload?.headers?.find(
    (item) => item.name.toLowerCase() === name.toLowerCase(),
  )?.value || "";
const emailAddress = (value: string) =>
  (value.match(/<([^>]+)>/)?.[1] || value).trim().toLowerCase();

export function utf8Base64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
export function decodeBase64Url(encoded: string): string {
  const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  return new TextDecoder().decode(
    Uint8Array.from(binary, (ch) => ch.charCodeAt(0)),
  );
}
function encodedSubject(subject: string): string {
  const chunks: string[] = [];
  let current = "";
  for (const char of subject) {
    if (new TextEncoder().encode(current + char).length > 42) {
      chunks.push(current);
      current = "";
    }
    current += char;
  }
  if (current) chunks.push(current);
  return chunks
    .map((chunk) => `=?UTF-8?B?${utf8Base64(chunk)}?=`)
    .join("\r\n ");
}
export function buildMime({
  to,
  subject,
  body,
  inReplyTo,
  references,
}: {
  to: string;
  subject: string;
  body: string;
  inReplyTo?: string;
  references?: string;
}): string {
  if (
    !/^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(to) ||
    /[\r\n]/.test(to + subject + (inReplyTo || "") + (references || ""))
  )
    throw new Error(
      "Email address or headers are invalid. Edit this draft before sending.",
    );
  if (!subject.trim() || !body.trim())
    throw new Error("Email subject and body are required.");
  const fullBody =
    /(?:prefer|want|like)\s+no\s+(?:more\s+)?follow[- ]?ups|(?:reply|let me know)[^\n]{0,60}\b(?:opt[- ]?out|unsubscribe|stop emailing|stop contacting)\b/i.test(
      body,
    )
      ? body
      : `${body.trim()}\n\n${optOutLine}`;
  const encodedBody =
    utf8Base64(fullBody.replace(/\r?\n/g, "\r\n"))
      .match(/.{1,76}/g)
      ?.join("\r\n") || "";
  const lines = [
    `To: ${to}`,
    `Subject: ${encodedSubject(subject)}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
  ];
  if (inReplyTo) lines.push(`In-Reply-To: ${inReplyTo}`);
  if (references) lines.push(`References: ${references}`);
  const mime = `${lines.join("\r\n")}\r\n\r\n${encodedBody}`;
  return utf8Base64(mime)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function sendEmail({
  to,
  subject,
  body,
  threadId,
}: {
  to: string;
  subject: string;
  body: string;
  threadId?: string;
}): Promise<{ id: string; threadId: string }> {
  let inReplyTo: string | undefined;
  let references: string | undefined;
  if (threadId) {
    const thread = await googleRequest<GmailThread>(
      `${base}/threads/${encodeURIComponent(threadId)}?format=metadata&metadataHeaders=Message-ID&metadataHeaders=References&metadataHeaders=Subject`,
    );
    const messages = thread.messages || [];
    const last = messages[messages.length - 1];
    if (last) {
      const messageId = header(last, "Message-ID");
      if (/^<[^\r\n<>]+>$/.test(messageId)) {
        inReplyTo = messageId;
        references = [header(last, "References"), messageId]
          .filter(Boolean)
          .join(" ");
      }
      const originalSubject = header(messages[0], "Subject");
      const normalizeSubject = (value: string) =>
        value.replace(/^(?:re:\s*)+/i, "").trim();
      if (
        originalSubject &&
        normalizeSubject(subject) !== normalizeSubject(originalSubject)
      )
        throw new Error(
          `This reply must keep the Gmail thread subject. Edit its subject to: ${originalSubject}, then approve it again.`,
        );
    }
  }
  const raw = buildMime({ to, subject, body, inReplyTo, references });
  const result = await googleRequest<{ id: string; threadId: string }>(
    `${base}/messages/send`,
    {
      method: "POST",
      body: JSON.stringify({ raw, ...(threadId ? { threadId } : {}) }),
    },
  );
  if (!result.id || !result.threadId)
    throw new Error(
      "Gmail did not confirm the message ID. Check your sent mail before retrying.",
    );
  return result;
}

export function messageText(part?: GmailPart): string {
  if (!part || part.filename) return "";
  if (part.mimeType === "text/plain" && part.body?.data)
    return decodeBase64Url(part.body.data);
  const parts = part.parts || [];
  const plain = parts
    .filter((item) => item.mimeType === "text/plain")
    .map(messageText)
    .filter(Boolean);
  if (plain.length) return plain.join("\n");
  const nested = parts.map(messageText).filter(Boolean);
  if (nested.length) return nested.join("\n");
  if (part.mimeType === "text/html" && part.body?.data)
    return decodeBase64Url(part.body.data)
      .replace(/<blockquote\b[^>]*>[\s\S]*?<\/blockquote>/gi, "")
      .replace(
        /<div\b[^>]*class=["'][^"']*gmail_quote[^"']*["'][^>]*>[\s\S]*$/i,
        "",
      )
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
      .replace(/<br\s*\/?>|<\/p>/gi, "\n")
      .replace(/<[^>]*>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");
  return "";
}

export function latestReplyText(text: string): string {
  // Exclude quoted outreach: its opt-out footer is not the recipient declining.
  return text
    .split(
      /\nOn [^\n]+wrote:\s*\n|\n-{2,}\s*(?:Original|Forwarded) Message\s*-*\n|\nFrom:[^\n]+\nSent:/i,
    )[0]
    .split("\n")
    .filter((line) => !/^\s*>/.test(line))
    .join("\n")
    .trim();
}

export function incomingReplies(
  thread: GmailThread,
  ownEmail: string,
): { text: string; from: string; id: string }[] {
  const messages = thread.messages || [];
  const sent = messages.filter((message) => message.labelIds?.includes("SENT"));
  if (!sent.length) return [];
  const self = new Set([
    ownEmail.toLowerCase(),
    ...sent.map((message) => emailAddress(header(message, "From"))),
  ]);
  const firstSentAt = Math.min(
    ...sent.map((message) => Number(message.internalDate || 0)),
  );
  return messages
    .filter(
      (message) =>
        !message.labelIds?.some((label) =>
          ["SENT", "DRAFT", "TRASH", "SPAM"].includes(label),
        ) &&
        Number(message.internalDate || 0) >= firstSentAt &&
        !self.has(emailAddress(header(message, "From"))),
    )
    .map((message) => ({
      id: message.id,
      from: header(message, "From"),
      text: latestReplyText(
        messageText(message.payload) || message.snippet || "",
      ),
    }))
    .filter((reply) => reply.text.trim() && reply.from.trim());
}

export async function getThreadReplies(
  threadId: string,
): Promise<{ text: string; from: string; id: string }[]> {
  const [thread, profile] = await Promise.all([
    googleRequest<GmailThread>(
      `${base}/threads/${encodeURIComponent(threadId)}?format=full`,
    ),
    googleRequest<{ emailAddress: string }>(`${base}/profile`),
  ]);
  return incomingReplies(thread, profile.emailAddress);
}
