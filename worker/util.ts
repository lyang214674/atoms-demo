export const now = () => Date.now();

export const uid = () => crypto.randomUUID();

/** Short URL-safe slug for share links. */
export function slug(len = 8) {
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let out = "";
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}

export function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

export function isEmail(s: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

/** Strip ```html fences and any prose before <!doctype/<html. */
/** Reasoning models may prepend a <think>…</think> block; drop it. */
const stripThink = (s: string) => s.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

export function extractHtml(raw: string): string {
  let s = stripThink(raw);
  const fence = s.match(/```(?:html)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.search(/<!doctype html|<html[\s>]/i);
  if (start > 0) s = s.slice(start);
  const end = s.lastIndexOf("</html>");
  if (end !== -1) s = s.slice(0, end + "</html>".length);
  return s.trim();
}

/** Parse the first JSON object in a model reply. */
export function extractJson<T>(raw: string): T | null {
  let s = stripThink(raw);
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end === -1) return null;
  try {
    return JSON.parse(s.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}
