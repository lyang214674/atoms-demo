import type { Env } from "./env";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

/**
 * Stream a chat completion from any OpenAI-compatible endpoint.
 * Yields text deltas. The Worker only forwards bytes, so CPU time stays tiny.
 */
export async function* streamChat(env: Env, messages: ChatMessage[], opts?: { temperature?: number; maxTokens?: number }) {
  if (!env.LLM_API_KEY) throw new Error("LLM_API_KEY is not configured on the server");
  const res = await fetch(`${env.LLM_BASE_URL.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${env.LLM_API_KEY}` },
    body: JSON.stringify({
      model: env.LLM_MODEL,
      messages,
      stream: true,
      temperature: opts?.temperature ?? 0.4,
      max_tokens: opts?.maxTokens ?? 8000,
    }),
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    throw new Error(`LLM ${res.status}: ${text.slice(0, 300)}`);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") return;
      try {
        const json = JSON.parse(data);
        const delta: string | undefined = json.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      } catch {
        // ignore keep-alives / partial lines
      }
    }
  }
}

/** Non-streaming convenience: collect the whole reply. */
export async function chat(env: Env, messages: ChatMessage[], opts?: { temperature?: number; maxTokens?: number }) {
  let out = "";
  for await (const t of streamChat(env, messages, opts)) out += t;
  return out;
}
