export type Env = {
  DB: D1Database;
  ASSETS: Fetcher;
  LLM_BASE_URL: string;
  LLM_MODEL: string;
  /** Optional cheaper model for Planner / Reviewer. Falls back to LLM_MODEL. */
  LLM_MODEL_FAST?: string;
  LLM_API_KEY: string;
  DAILY_GEN_LIMIT: string;
  GLOBAL_DAILY_GEN_LIMIT?: string;
};

export type Vars = { userId: string | null };
