import type { Env } from "./env";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

export type ChatOpts = { temperature?: number; maxTokens?: number; /** "fast" = cheaper model for plan/review */ tier?: "fast" | "main" };

/**
 * Two providers behind one streaming interface:
 *  - "workers-ai": Cloudflare Workers AI via the `AI` binding. No key, no region
 *    restrictions, free daily allowance. Default for the hosted demo.
 *  - "openai": any OpenAI-compatible HTTP endpoint (OpenAI / DeepSeek / Gemini / Groq…).
 * The Worker only forwards text deltas, so CPU time stays tiny.
 */

const RETRY_DELAYS_MS = [1500, 4000, 8000];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const isTransient = (msg: string) => /\b(429|503)\b|capacity|rate limit|overload|too many/i.test(msg);

function pickModel(env: Env, tier: ChatOpts["tier"]) {
  if (tier === "fast" && env.LLM_MODEL_FAST) return env.LLM_MODEL_FAST;
  return env.LLM_MODEL;
}

export function providerOf(env: Env): "workers-ai" | "openai" {
  if (env.LLM_PROVIDER === "openai") return "openai";
  if (env.LLM_PROVIDER === "workers-ai") return "workers-ai";
  return env.AI ? "workers-ai" : "openai";
}

/** Parse an SSE byte stream; yields text deltas in OpenAI (`choices[].delta.content`) or Workers AI (`response`) shape. */
async function* readSSE(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
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
        const delta: string | undefined = json.choices?.[0]?.delta?.content ?? json.response;
        if (delta) yield delta;
      } catch {
        // ignore keep-alives / partial lines
      }
    }
  }
}

// ---------- provider: OpenAI-compatible HTTP ----------

/** Retry on 429 (rate limit) / 503 (overloaded) / 500 before giving up. */
async function fetchWithRetry(url: string, init: RequestInit) {
  let last: Response | null = null;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    const res = await fetch(url, init);
    if (res.ok || (res.status !== 429 && res.status !== 503 && res.status !== 500)) return res;
    last = res;
    if (attempt < RETRY_DELAYS_MS.length) {
      await res.body?.cancel().catch(() => {});
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }
  return last!;
}

async function openStreamOpenAI(env: Env, messages: ChatMessage[], opts?: ChatOpts) {
  if (!env.LLM_API_KEY) throw new Error("LLM_API_KEY is not configured on the server");
  const res = await fetchWithRetry(`${(env.LLM_BASE_URL ?? "").replace(/\/$/, "")}/chat/completions`, {
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
  return res.body;
}

// ---------- provider: Workers AI binding ----------

async function openStreamWorkersAI(env: Env, messages: ChatMessage[], opts?: ChatOpts) {
  if (!env.AI) throw new Error("Workers AI binding `AI` is not configured");
  const model = pickModel(env, opts?.tier);
  let lastErr: unknown;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      // Model ids are validated at runtime; the binding's type union lags behind the catalog.
      const out = (await env.AI.run(model as never, {
        messages,
        stream: true,
        temperature: opts?.temperature ?? 0.4,
        max_tokens: opts?.maxTokens ?? 8000,
      } as never)) as unknown;
      if (out instanceof ReadableStream) return out as ReadableStream<Uint8Array>;
      // Some models ignore `stream`; wrap the JSON reply as a single delta.
      const o = out as { response?: string; choices?: { message?: { content?: string } }[] };
      const text = o.choices?.[0]?.message?.content ?? o.response ?? "";
      return new Response(`data: ${JSON.stringify({ response: text })}\n\ndata: [DONE]\n\n`).body!;
    } catch (e) {
      lastErr = e;
      const msg = e instanceof Error ? e.message : String(e);
      // Retry only on capacity / rate-limit style failures.
      if (!isTransient(msg) || attempt === RETRY_DELAYS_MS.length) break;
      await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }
  const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
  const hint = /\b429\b|rate limit|too many|quota|limit exceeded/i.test(msg)
    ? "模型额度暂时用完，请稍后再试。"
    : /\b503\b|capacity|overload/i.test(msg)
      ? "模型服务繁忙，请稍后重试。"
      : "";
  throw new Error(`${hint} (Workers AI: ${msg.replace(/\s+/g, " ").slice(0, 200)})`);
}

// ---------- public API ----------

export async function* streamChat(env: Env, messages: ChatMessage[], opts?: ChatOpts) {
  const body = providerOf(env) === "workers-ai" ? await openStreamWorkersAI(env, messages, opts) : await openStreamOpenAI(env, messages, opts);
  yield* readSSE(body);
}

/** Non-streaming convenience: collect the whole reply. */
export async function chat(env: Env, messages: ChatMessage[], opts?: ChatOpts) {
  let out = "";
  for await (const t of streamChat(env, messages, opts)) out += t;
  return out;
}
