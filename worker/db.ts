import type { AgentEvent, AgentRole, Plan, Project, ProjectSummary, Review, Version, VersionStatus } from "../shared/types";
import { now, todayUTC, uid } from "./util";

type VersionRow = {
  id: string;
  project_id: string;
  n: number;
  user_message: string;
  plan_json: string | null;
  html: string | null;
  review_json: string | null;
  status: VersionStatus;
  created_at: number;
};

export function rowToVersion(r: VersionRow): Version {
  return {
    id: r.id,
    project_id: r.project_id,
    n: r.n,
    user_message: r.user_message,
    plan: r.plan_json ? (JSON.parse(r.plan_json) as Plan) : null,
    html: r.html,
    review: r.review_json ? (JSON.parse(r.review_json) as Review) : null,
    status: r.status,
    created_at: r.created_at,
  };
}

export async function getProject(db: D1Database, id: string) {
  return db.prepare("SELECT * FROM projects WHERE id = ?").bind(id).first<Project>();
}

export async function getProjectBySlug(db: D1Database, slug: string) {
  return db.prepare("SELECT * FROM projects WHERE share_slug = ?").bind(slug).first<Project>();
}

export async function listProjects(db: D1Database, userId: string): Promise<ProjectSummary[]> {
  const { results } = await db
    .prepare(
      `SELECT p.*, 
              COALESCE((SELECT MAX(n) FROM versions v WHERE v.project_id = p.id), 0) AS latest_n,
              COALESCE((SELECT status FROM versions v WHERE v.project_id = p.id ORDER BY n DESC LIMIT 1), 'planning') AS latest_status
       FROM projects p WHERE p.user_id = ? ORDER BY p.updated_at DESC LIMIT 100`,
    )
    .bind(userId)
    .all<ProjectSummary>();
  return results;
}

export async function listVersions(db: D1Database, projectId: string): Promise<Version[]> {
  const { results } = await db
    .prepare("SELECT * FROM versions WHERE project_id = ? ORDER BY n ASC")
    .bind(projectId)
    .all<VersionRow>();
  return results.map(rowToVersion);
}

export async function getVersion(db: D1Database, id: string) {
  const r = await db.prepare("SELECT * FROM versions WHERE id = ?").bind(id).first<VersionRow>();
  return r ? rowToVersion(r) : null;
}

export async function latestDoneVersion(db: D1Database, projectId: string) {
  const r = await db
    .prepare("SELECT * FROM versions WHERE project_id = ? AND status = 'done' ORDER BY n DESC LIMIT 1")
    .bind(projectId)
    .first<VersionRow>();
  return r ? rowToVersion(r) : null;
}

export async function previousVersion(db: D1Database, projectId: string, beforeN: number) {
  const r = await db
    .prepare("SELECT * FROM versions WHERE project_id = ? AND n < ? AND status = 'done' ORDER BY n DESC LIMIT 1")
    .bind(projectId, beforeN)
    .first<VersionRow>();
  return r ? rowToVersion(r) : null;
}

export async function createProject(db: D1Database, userId: string, prompt: string, opts?: { title?: string; forkedFrom?: string }) {
  const id = uid();
  const t = now();
  const title = opts?.title ?? prompt.slice(0, 40);
  await db
    .prepare("INSERT INTO projects (id, user_id, title, prompt, share_slug, forked_from, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, ?, ?, ?)")
    .bind(id, userId, title, prompt, opts?.forkedFrom ?? null, t, t)
    .run();
  return (await getProject(db, id))!;
}

export async function createVersion(db: D1Database, projectId: string, userMessage: string) {
  const nRow = await db
    .prepare("SELECT COALESCE(MAX(n), 0) + 1 AS n FROM versions WHERE project_id = ?")
    .bind(projectId)
    .first<{ n: number }>();
  const id = uid();
  await db
    .prepare("INSERT INTO versions (id, project_id, n, user_message, status, created_at) VALUES (?, ?, ?, ?, 'planning', ?)")
    .bind(id, projectId, nRow!.n, userMessage, now())
    .run();
  await touchProject(db, projectId);
  return (await getVersion(db, id))!;
}

export async function touchProject(db: D1Database, projectId: string) {
  await db.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").bind(now(), projectId).run();
}

export async function updateVersion(
  db: D1Database,
  id: string,
  patch: Partial<{ plan: Plan; html: string; review: Review; status: VersionStatus }>,
) {
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (patch.plan !== undefined) (sets.push("plan_json = ?"), vals.push(JSON.stringify(patch.plan)));
  if (patch.html !== undefined) (sets.push("html = ?"), vals.push(patch.html));
  if (patch.review !== undefined) (sets.push("review_json = ?"), vals.push(JSON.stringify(patch.review)));
  if (patch.status !== undefined) (sets.push("status = ?"), vals.push(patch.status));
  if (!sets.length) return;
  vals.push(id);
  await db.prepare(`UPDATE versions SET ${sets.join(", ")} WHERE id = ?`).bind(...vals).run();
}

export async function logEvent(db: D1Database, versionId: string, role: AgentRole, type: AgentEvent["type"], content?: string) {
  await db
    .prepare("INSERT INTO agent_events (version_id, role, type, content, ts) VALUES (?, ?, ?, ?, ?)")
    .bind(versionId, role, type, content ?? null, now())
    .run();
}

export async function listEvents(db: D1Database, versionId: string): Promise<AgentEvent[]> {
  const { results } = await db
    .prepare("SELECT * FROM agent_events WHERE version_id = ? ORDER BY id ASC")
    .bind(versionId)
    .all<AgentEvent>();
  return results;
}

/**
 * Returns "ok" | "user" | "global". Two caps guard the free LLM quota:
 * a per-user daily cap and a global (all users) daily cap.
 */
export async function consumeDailyQuota(db: D1Database, userId: string, limit: number, globalLimit: number) {
  const day = todayUTC();
  const [row, total] = await Promise.all([
    db.prepare("SELECT count FROM usage_daily WHERE user_id = ? AND day = ?").bind(userId, day).first<{ count: number }>(),
    db.prepare("SELECT COALESCE(SUM(count), 0) AS total FROM usage_daily WHERE day = ?").bind(day).first<{ total: number }>(),
  ]);
  if ((total?.total ?? 0) >= globalLimit) return "global" as const;
  const count = row?.count ?? 0;
  if (count >= limit) return "user" as const;
  await db
    .prepare(
      "INSERT INTO usage_daily (user_id, day, count) VALUES (?, ?, 1) ON CONFLICT(user_id, day) DO UPDATE SET count = count + 1",
    )
    .bind(userId, day)
    .run();
  return "ok" as const;
}

export async function lastEventTs(db: D1Database, versionId: string) {
  const row = await db.prepare("SELECT MAX(ts) AS ts FROM agent_events WHERE version_id = ?").bind(versionId).first<{ ts: number | null }>();
  return row?.ts ?? null;
}

/** Give back one generation after a failed build. */
export async function refundDailyQuota(db: D1Database, userId: string) {
  await db
    .prepare("UPDATE usage_daily SET count = MAX(count - 1, 0) WHERE user_id = ? AND day = ?")
    .bind(userId, todayUTC())
    .run();
}
