export type Env = {
  DB: D1Database;
  ASSETS: Fetcher;
  LLM_BASE_URL: string;
  LLM_MODEL: string;
  LLM_API_KEY: string;
  DAILY_GEN_LIMIT: string;
};

export type Vars = { userId: string | null };
