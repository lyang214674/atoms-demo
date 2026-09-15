export type Env = {
  DB: D1Database;
  ASSETS: Fetcher;
  /** Workers AI binding (default provider for the hosted demo). */
  AI?: Ai;
  /** "workers-ai" | "openai". Defaults to workers-ai when the AI binding exists. */
  LLM_PROVIDER?: string;
  /** OpenAI-compatible endpoint, only used when LLM_PROVIDER=openai. */
  LLM_BASE_URL?: string;
  LLM_MODEL: string;
  /** Optional cheaper model for Planner / Reviewer. Falls back to LLM_MODEL. */
  LLM_MODEL_FAST?: string;
  /** Secret; only used when LLM_PROVIDER=openai. */
  LLM_API_KEY?: string;
  DAILY_GEN_LIMIT: string;
  GLOBAL_DAILY_GEN_LIMIT?: string;
};

export type Vars = { userId: string | null };
