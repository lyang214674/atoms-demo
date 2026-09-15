import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { Env, Vars } from "./env";
import { createSession, destroySession, hashPassword, resolveUser, verifyPassword } from "./auth";
import { chat, streamChat } from "./llm";
import {
  BUILDER_SYSTEM,
  PLANNER_SYSTEM,
  REVIEWER_SYSTEM,
  builderUser,
  plannerUser,
  reviewerUser,
  staticChecks,
} from "./prompts";
import * as db from "./db";
import { extractHtml, extractJson, isEmail, now, slug, uid } from "./util";
import type { GalleryItem, Plan, Review, StreamEvent, User } from "../shared/types";

const app = new Hono<{ Bindings: Env; Variables: Vars }>();

// ---------- auth middleware ----------
app.use("*", async (c, next) => {
  c.set("userId", await resolveUser(c));
  await next();
});

const requireUser = (c: { get: (k: "userId") => string | null }) => {
  const id = c.get("userId");
  if (!id) throw new HttpError(401, "请先登录");
  return id;
};

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status as 400);
  console.error(err);
  return c.json({ error: err.message || "服务器错误" }, 500);
});

// ---------- auth ----------
app.post("/api/auth/register", async (c) => {
  const { email, password } = await c.req.json<{ email?: string; password?: string }>();
  const e = (email ?? "").trim().toLowerCase();
  if (!isEmail(e)) throw new HttpError(400, "邮箱格式不正确");
  if (!password || password.length < 6) throw new HttpError(400, "密码至少 6 位");
  const exists = await c.env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(e).first();
  if (exists) throw new HttpError(409, "该邮箱已注册，请直接登录");
  const { hash, salt } = await hashPassword(password);
  const id = uid();
  await c.env.DB.prepare("INSERT INTO users (id, email, password_hash, salt, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(id, e, hash, salt, now())
    .run();
  await createSession(c, id);
  return c.json<User>({ id, email: e, created_at: now() });
});

app.post("/api/auth/login", async (c) => {
  const { email, password } = await c.req.json<{ email?: string; password?: string }>();
  const e = (email ?? "").trim().toLowerCase();
  const row = await c.env.DB.prepare("SELECT id, email, password_hash, salt, created_at FROM users WHERE email = ?")
    .bind(e)
    .first<{ id: string; email: string; password_hash: string; salt: string; created_at: number }>();
  if (!row || !password || !(await verifyPassword(password, row.password_hash, row.salt))) {
    throw new HttpError(401, "邮箱或密码错误");
  }
  await createSession(c, row.id);
  return c.json<User>({ id: row.id, email: row.email, created_at: row.created_at });
});

app.post("/api/auth/logout", async (c) => {
  await destroySession(c);
  return c.json({ ok: true });
});

app.get("/api/me", async (c) => {
  const id = c.get("userId");
  if (!id) return c.json({ user: null });
  const user = await c.env.DB.prepare("SELECT id, email, created_at FROM users WHERE id = ?").bind(id).first<User>();
  return c.json({ user });
});

// ---------- projects ----------
app.get("/api/projects", async (c) => {
  const userId = requireUser(c);
  return c.json({ projects: await db.listProjects(c.env.DB, userId) });
});

app.post("/api/projects", async (c) => {
  const userId = requireUser(c);
  const { prompt } = await c.req.json<{ prompt?: string }>();
  const p = (prompt ?? "").trim();
  if (p.length < 4) throw new HttpError(400, "再多描述一点你想做的应用");
  if (p.length > 2000) throw new HttpError(400, "描述太长了（最多 2000 字）");
  const project = await db.createProject(c.env.DB, userId, p);
  const version = await db.createVersion(c.env.DB, project.id, p);
  return c.json({ project, version });
});

app.get("/api/projects/:id", async (c) => {
  const userId = requireUser(c);
  const project = await db.getProject(c.env.DB, c.req.param("id"));
  if (!project || project.user_id !== userId) throw new HttpError(404, "项目不存在");
  const versions = await db.listVersions(c.env.DB, project.id);
  return c.json({ project, versions });
});

app.patch("/api/projects/:id", async (c) => {
  const userId = requireUser(c);
  const project = await db.getProject(c.env.DB, c.req.param("id"));
  if (!project || project.user_id !== userId) throw new HttpError(404, "项目不存在");
  const { title } = await c.req.json<{ title?: string }>();
  if (title && title.trim()) {
    await c.env.DB.prepare("UPDATE projects SET title = ?, updated_at = ? WHERE id = ?")
      .bind(title.trim().slice(0, 60), now(), project.id)
      .run();
  }
  return c.json({ project: await db.getProject(c.env.DB, project.id) });
});

app.delete("/api/projects/:id", async (c) => {
  const userId = requireUser(c);
  const project = await db.getProject(c.env.DB, c.req.param("id"));
  if (!project || project.user_id !== userId) throw new HttpError(404, "项目不存在");
  await c.env.DB.prepare("DELETE FROM projects WHERE id = ?").bind(project.id).run();
  return c.json({ ok: true });
});

/** Start an iteration: creates a new version to be planned + built. */
app.post("/api/projects/:id/iterate", async (c) => {
  const userId = requireUser(c);
  const project = await db.getProject(c.env.DB, c.req.param("id"));
  if (!project || project.user_id !== userId) throw new HttpError(404, "项目不存在");
  const { message } = await c.req.json<{ message?: string }>();
  const m = (message ?? "").trim();
  if (m.length < 2) throw new HttpError(400, "说说你想改什么");
  const version = await db.createVersion(c.env.DB, project.id, m);
  return c.json({ version });
});

app.post("/api/projects/:id/share", async (c) => {
  const userId = requireUser(c);
  const project = await db.getProject(c.env.DB, c.req.param("id"));
  if (!project || project.user_id !== userId) throw new HttpError(404, "项目不存在");
  const done = await db.latestDoneVersion(c.env.DB, project.id);
  if (!done) throw new HttpError(400, "还没有生成完成的版本，无法分享");
  let s = project.share_slug;
  if (!s) {
    s = slug();
    await c.env.DB.prepare("UPDATE projects SET share_slug = ?, updated_at = ? WHERE id = ?").bind(s, now(), project.id).run();
  }
  return c.json({ share_slug: s });
});

app.delete("/api/projects/:id/share", async (c) => {
  const userId = requireUser(c);
  const project = await db.getProject(c.env.DB, c.req.param("id"));
  if (!project || project.user_id !== userId) throw new HttpError(404, "项目不存在");
  await c.env.DB.prepare("UPDATE projects SET share_slug = NULL, updated_at = ? WHERE id = ?").bind(now(), project.id).run();
  return c.json({ ok: true });
});

// ---------- versions / agents ----------
app.get("/api/versions/:vid/events", async (c) => {
  const userId = requireUser(c);
  const v = await db.getVersion(c.env.DB, c.req.param("vid"));
  if (!v) throw new HttpError(404, "版本不存在");
  const project = await db.getProject(c.env.DB, v.project_id);
  if (!project || project.user_id !== userId) throw new HttpError(404, "版本不存在");
  return c.json({ events: await db.listEvents(c.env.DB, v.id) });
});

async function ownedVersion(c: { env: Env; get: (k: "userId") => string | null }, vid: string) {
  const userId = requireUser(c);
  const v = await db.getVersion(c.env.DB, vid);
  if (!v) throw new HttpError(404, "版本不存在");
  const project = await db.getProject(c.env.DB, v.project_id);
  if (!project || project.user_id !== userId) throw new HttpError(404, "版本不存在");
  return { userId, version: v, project };
}

/** Planner: idea (or change request + previous plan) -> plan JSON. Streams tokens. */
app.post("/api/versions/:vid/plan", async (c) => {
  const { version, project } = await ownedVersion(c, c.req.param("vid"));
  const prev = version.n > 1 ? await db.previousVersion(c.env.DB, project.id, version.n) : null;

  return streamSSE(c, async (stream) => {
    const send = (e: StreamEvent) => stream.writeSSE({ data: JSON.stringify(e) });
    try {
      await db.updateVersion(c.env.DB, version.id, { status: "planning" });
      await db.logEvent(c.env.DB, version.id, "planner", "start", version.user_message);
      await send({ type: "step_start", role: "planner", label: "Planner 正在拆解需求" });

      let raw = "";
      for await (const t of streamChat(
        c.env,
        [
          { role: "system", content: PLANNER_SYSTEM },
          { role: "user", content: plannerUser(version.user_message, prev ? { plan: prev.plan, message: version.user_message } : undefined) },
        ],
        { temperature: 0.3, maxTokens: 1500 },
      )) {
        raw += t;
        await send({ type: "token", role: "planner", text: t });
      }
      const plan = extractJson<Plan>(raw);
      if (!plan || !plan.app_name || !Array.isArray(plan.features)) throw new Error("Planner 没有返回有效的计划，请重试");
      await db.updateVersion(c.env.DB, version.id, { plan, status: "planned" });
      await db.logEvent(c.env.DB, version.id, "planner", "done", JSON.stringify(plan));
      if (version.n === 1) {
        await c.env.DB.prepare("UPDATE projects SET title = ?, updated_at = ? WHERE id = ?")
          .bind(plan.app_name.slice(0, 60), now(), project.id)
          .run();
      }
      await send({ type: "plan", plan });
      await send({ type: "step_done", role: "planner", label: "计划已生成，等待你确认" });
      await send({ type: "version", version: (await db.getVersion(c.env.DB, version.id))! });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await db.updateVersion(c.env.DB, version.id, { status: "failed" });
      await db.logEvent(c.env.DB, version.id, "planner", "error", message);
      await send({ type: "error", message });
    } finally {
      await send({ type: "end" });
    }
  });
});

/** Builder + Reviewer: plan -> HTML -> review. Streams tokens. Consumes daily quota. */
app.post("/api/versions/:vid/build", async (c) => {
  const { userId, version, project } = await ownedVersion(c, c.req.param("vid"));
  const body = await c.req.json<{ plan?: Plan }>().catch(() => ({} as { plan?: Plan }));
  const plan = body.plan ?? version.plan;
  if (!plan) throw new HttpError(400, "请先生成计划");
  const limit = Number(c.env.DAILY_GEN_LIMIT || "30");
  if (!(await db.consumeDailyQuota(c.env.DB, userId, limit))) {
    throw new HttpError(429, `今天的生成次数已用完（每日 ${limit} 次），明天再来`);
  }
  const prev = version.n > 1 ? await db.previousVersion(c.env.DB, project.id, version.n) : null;

  return streamSSE(c, async (stream) => {
    const send = (e: StreamEvent) => stream.writeSSE({ data: JSON.stringify(e) });
    try {
      await db.updateVersion(c.env.DB, version.id, { plan, status: "building" });
      await db.logEvent(c.env.DB, version.id, "builder", "start", plan.app_name);
      await send({ type: "step_start", role: "builder", label: "Builder 正在编写应用代码" });

      let raw = "";
      for await (const t of streamChat(
        c.env,
        [
          { role: "system", content: BUILDER_SYSTEM },
          { role: "user", content: builderUser(plan, prev?.html ? { previousHtml: prev.html, message: version.user_message } : undefined) },
        ],
        { temperature: 0.4, maxTokens: 12000 },
      )) {
        raw += t;
        await send({ type: "token", role: "builder", text: t });
      }
      const html = extractHtml(raw);
      if (!/<html[\s>]/i.test(html) || !/<\/html>/i.test(html)) throw new Error("Builder 没有返回完整的 HTML，请重试");
      await db.updateVersion(c.env.DB, version.id, { html });
      await db.logEvent(c.env.DB, version.id, "builder", "done", `${html.length} chars`);
      await send({ type: "html", html });
      await send({ type: "step_done", role: "builder", label: "代码已生成" });

      // Reviewer: static checks always; model review best-effort.
      await db.logEvent(c.env.DB, version.id, "reviewer", "start");
      await send({ type: "step_start", role: "reviewer", label: "Reviewer 正在检查功能与质量" });
      const checks = staticChecks(html);
      let review: Review = {
        verdict: checks.every((k) => k.ok) ? "pass" : "warn",
        checks,
        notes: "已完成静态检查。",
      };
      try {
        const reviewRaw = await chat(
          c.env,
          [
            { role: "system", content: REVIEWER_SYSTEM },
            { role: "user", content: reviewerUser(plan, html.slice(0, 60000)) },
          ],
          { temperature: 0.1, maxTokens: 800 },
        );
        const modelReview = extractJson<Review>(reviewRaw);
        if (modelReview && Array.isArray(modelReview.checks)) {
          review = {
            verdict: modelReview.verdict === "pass" && review.verdict === "pass" ? "pass" : "warn",
            checks: [...checks, ...modelReview.checks],
            notes: modelReview.notes || review.notes,
          };
        }
      } catch (e) {
        review.notes += " 模型审查未完成，仅保留静态检查。";
      }
      await db.updateVersion(c.env.DB, version.id, { review, status: "done" });
      await db.logEvent(c.env.DB, version.id, "reviewer", "done", JSON.stringify(review));
      await db.touchProject(c.env.DB, project.id);
      await send({ type: "review", review });
      await send({ type: "step_done", role: "reviewer", label: review.verdict === "pass" ? "审查通过" : "审查有提醒" });
      await send({ type: "version", version: (await db.getVersion(c.env.DB, version.id))! });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await db.updateVersion(c.env.DB, version.id, { status: "failed" });
      await db.logEvent(c.env.DB, version.id, "builder", "error", message);
      await send({ type: "error", message });
    } finally {
      await send({ type: "end" });
    }
  });
});

// ---------- public: gallery, share, remix ----------
app.get("/api/gallery", async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT p.share_slug, p.title, p.prompt, p.updated_at,
            (SELECT json_extract(v.plan_json, '$.app_name') FROM versions v WHERE v.project_id = p.id AND v.status='done' ORDER BY n DESC LIMIT 1) AS app_name
     FROM projects p WHERE p.share_slug IS NOT NULL ORDER BY p.updated_at DESC LIMIT 24`,
  ).all<GalleryItem>();
  return c.json({ items: results });
});

app.get("/api/share/:slug", async (c) => {
  const project = await db.getProjectBySlug(c.env.DB, c.req.param("slug"));
  if (!project) throw new HttpError(404, "分享不存在或已关闭");
  const v = await db.latestDoneVersion(c.env.DB, project.id);
  if (!v) throw new HttpError(404, "分享不存在或已关闭");
  return c.json({
    project: { title: project.title, prompt: project.prompt, share_slug: project.share_slug, updated_at: project.updated_at },
    version: { n: v.n, plan: v.plan, html: v.html, review: v.review, created_at: v.created_at },
  });
});

app.post("/api/remix/:slug", async (c) => {
  const userId = requireUser(c);
  const src = await db.getProjectBySlug(c.env.DB, c.req.param("slug"));
  if (!src) throw new HttpError(404, "分享不存在或已关闭");
  const v = await db.latestDoneVersion(c.env.DB, src.id);
  if (!v || !v.html || !v.plan) throw new HttpError(404, "分享不存在或已关闭");
  const project = await db.createProject(c.env.DB, userId, src.prompt, { title: `${src.title} (Remix)`, forkedFrom: src.id });
  const version = await db.createVersion(c.env.DB, project.id, src.prompt);
  await db.updateVersion(c.env.DB, version.id, { plan: v.plan, html: v.html, review: v.review ?? undefined, status: "done" });
  await db.logEvent(c.env.DB, version.id, "system", "done", `Remixed from ${src.share_slug}`);
  return c.json({ project });
});

/** Raw runnable HTML. CSP sandbox gives it an opaque origin so it cannot use the viewer's cookies. */
const RAW_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "content-security-policy": "sandbox allow-scripts allow-forms allow-modals allow-popups",
  "x-frame-options": "SAMEORIGIN",
  "cache-control": "no-store",
};

app.get("/raw/s/:slug", async (c) => {
  const project = await db.getProjectBySlug(c.env.DB, c.req.param("slug"));
  const v = project ? await db.latestDoneVersion(c.env.DB, project.id) : null;
  if (!v?.html) return c.text("Not found", 404);
  return new Response(v.html, { headers: RAW_HEADERS });
});

app.get("/raw/v/:vid", async (c) => {
  const { version } = await ownedVersion(c, c.req.param("vid"));
  if (!version.html) return c.text("Not found", 404);
  return new Response(version.html, { headers: RAW_HEADERS });
});

app.get("/api/health", (c) => c.json({ ok: true, model: c.env.LLM_MODEL, hasKey: Boolean(c.env.LLM_API_KEY) }));

// Anything else under /api is 404 JSON; other paths fall through to static assets (SPA).
app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
