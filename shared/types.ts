// Types shared between the Worker (API) and the React app.

export type User = { id: string; email: string; created_at: number };

export type Plan = {
  app_name: string;
  summary: string;
  features: string[];
  sections: string[];
  data_model: string[];
  style: string;
};

export type Review = {
  verdict: "pass" | "fixed" | "warn";
  checks: { name: string; ok: boolean; note?: string }[];
  notes: string;
};

export type VersionStatus = "planning" | "planned" | "building" | "done" | "failed";

export type Version = {
  id: string;
  project_id: string;
  n: number;
  user_message: string;
  plan: Plan | null;
  html: string | null;
  review: Review | null;
  status: VersionStatus;
  created_at: number;
};

export type Project = {
  id: string;
  user_id: string;
  title: string;
  prompt: string;
  share_slug: string | null;
  forked_from: string | null;
  created_at: number;
  updated_at: number;
};

export type ProjectSummary = Project & { latest_n: number; latest_status: VersionStatus };

export type AgentRole = "planner" | "builder" | "reviewer" | "system";

export type AgentEvent = {
  id: number;
  version_id: string;
  role: AgentRole;
  type: "start" | "message" | "done" | "error";
  content: string | null;
  ts: number;
};

/** Server-sent events emitted while an agent step runs. */
export type StreamEvent =
  | { type: "step_start"; role: AgentRole; label: string }
  | { type: "token"; role: AgentRole; text: string }
  | { type: "step_done"; role: AgentRole; label: string }
  | { type: "plan"; plan: Plan }
  | { type: "html"; html: string }
  | { type: "review"; review: Review }
  | { type: "version"; version: Version }
  | { type: "error"; message: string }
  | { type: "end" };

export type GalleryItem = {
  share_slug: string;
  title: string;
  prompt: string;
  updated_at: number;
  app_name: string | null;
};
