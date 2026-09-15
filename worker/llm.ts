import type { Env } from "./env";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

/**
 * Stream a chat completion from any OpenAI-compatible endpoint.
 * Yields text deltas. The Worker only forwards bytes, so CPU time stays tiny.
 */
export type ChatOpts = { temperature?: number; maxTokens?: number; /** "fast" = cheaper model for plan/review */ tier?: "fast" | "main" };

const RETRY_DELAYS_MS = [1500, 4000, 8000];

/** Free-tier friendly: retry on 429 (rate limit) and 503 (overloaded) before giving up. */
async function fetchWithRetry(url: string, init: RequestInit) {
  let last: Response | null = null;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    const res = await fetch(url, init);
    if (res.ok || (res.status !== 429 && res.status !== 503 && res.status !== 500)) return res;
    last = res;
    if (attempt < RETRY_DELAYS_MS.length) {
      await res.body?.cancel().catch(() => {});
      await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
    }
  }
  return last!;
}

function pickModel(env: Env, tier: ChatOpts["tier"]) {
  if (tier === "fast" && env.LLM_MODEL_FAST) return env.LLM_MODEL_FAST;
  return env.LLM_MODEL;
}

export async function* streamChat(env: Env, messages: ChatMessage[], opts?: ChatOpts) {
  if (!env.LLM_API_KEY) throw new Error("LLM_API_KEY is not configured on the server");
  const res = await fetchWithRetry(`${env.LLM_BASE_URL.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${env.LLM_API_KEY}` },
    body: JSON.stringify({
      model: pickModel(env, opts?.tier),
      messages,
      stream: true,
      temperature: opts?.temperature ?? 0.4,
      max_tokens: opts?.maxTokens ?? 8000,
    }),
  });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    const hint = res.status === 429 ? "模型额度暂时用完，请稍后再试。" : res.status === 503 ? "模型服务繁忙，请稍后重试。" : "";
    throw new Error(`${hint} (LLM ${res.status}: ${text.replace(/\s+/g, " ").slice(0, 200)})`);
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
export async function chat(env: Env, messages: ChatMessage[], opts?: ChatOpts) {
  let out = "";
  for await (const t of streamChat(env, messages, opts)) out += t;
  return out;
}
