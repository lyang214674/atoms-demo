/**
 * Pure policy helpers: request triage, quota SQL, login throttling.
 * No runtime bindings here so everything can be unit-tested with node:test.
 */

// ---------- request triage ----------

const QUESTION_RE = /^(什么是|为什么|为何|怎么|如何|能不能|可以吗|请问|介绍一下|解释一下|你觉得|有没有|是否)|[?？]\s*$/;
const VAGUE_RE = /^(帮我|请|给我)?(做|建|创建|生成|开发|写|来)(一个|个|一款|一下)?(简单|极简|好看|漂亮|现代|小)?(的)?(应用|app|网站|网页|页面|程序|小程序|工具|游戏|东西)?(吧|就好|即可|谢谢)?[。！!.]*$/i;

export type Triage = { kind: "build" } | { kind: "clarify"; message: string };

/**
 * Decide whether a prompt is ready to enter the Planner. We refuse two shapes
 * without spending a model call: plain questions, and prompts that name no
 * concrete interaction ("做一个应用").
 */
export function triagePrompt(raw: string): Triage {
  const p = raw.trim();
  const compact = p.replace(/\s+/g, "");
  if (QUESTION_RE.test(p) && !/(做|建|创建|生成|开发|实现|写)(一个|个|一款)?/.test(p)) {
    return {
      kind: "clarify",
      message: "这里只处理「要做什么应用」的描述。换成一句需求试试，例如：做一个记账本，能记收支、按月汇总、可删除。",
    };
  }
  if (compact.length < 6 || VAGUE_RE.test(compact)) {
    return {
      kind: "clarify",
      message: "再具体一点：这个应用最核心的操作是什么？例如「番茄钟，可设置时长、记录今日完成数」或「待办清单，可添加、勾选、删除」。",
    };
  }
  return { kind: "build" };
}

// ---------- generation quota ----------

/**
 * One statement checks both caps and reserves a slot. A read-then-write pair
 * would let two concurrent Workers both pass the check and overshoot.
 * Params, in order: userId, day, userId, day, userLimit, day, globalLimit.
 * `meta.changes === 0` means a cap was hit.
 */
export const QUOTA_RESERVE_SQL = `
INSERT INTO usage_daily (user_id, day, count)
SELECT ?, ?, 1
WHERE COALESCE((SELECT count FROM usage_daily WHERE user_id = ? AND day = ?), 0) < ?
  AND COALESCE((SELECT SUM(count) FROM usage_daily WHERE day = ?), 0) < ?
ON CONFLICT(user_id, day) DO UPDATE SET count = count + 1`.trim();

export function quotaReserveArgs(userId: string, day: string, userLimit: number, globalLimit: number) {
  return [userId, day, userId, day, userLimit, day, globalLimit];
}

// ---------- login / registration throttling ----------

export const AUTH_WINDOW_MS = 15 * 60_000;
export const AUTH_MAX_ATTEMPTS = 10;

/**
 * Fixed-window counter keyed by (ip, action). Resets when the window expired.
 * Params, in order: key, now, windowStart, windowStart.
 * Returns the count after this attempt.
 */
export const AUTH_ATTEMPT_SQL = `
INSERT INTO auth_attempts (key, count, window_start) VALUES (?, 1, ?)
ON CONFLICT(key) DO UPDATE SET
  count = CASE WHEN window_start < ? THEN 1 ELSE count + 1 END,
  window_start = CASE WHEN window_start < ? THEN excluded.window_start ELSE window_start END
RETURNING count`.trim();

export function authAttemptArgs(key: string, now: number, windowMs = AUTH_WINDOW_MS) {
  const windowStart = now - windowMs;
  return [key, now, windowStart, windowStart];
}

// ---------- origin check ----------

/** Same-origin check for state-changing requests. Local dev (Vite proxy) is exempt. */
export function originAllowed(origin: string | undefined, requestUrl: string) {
  if (!origin) return true; // non-browser clients / same-origin GET navigations
  try {
    const o = new URL(origin);
    if (o.hostname === "localhost" || o.hostname === "127.0.0.1") return true;
    return o.origin === new URL(requestUrl).origin;
  } catch {
    return false;
  }
}
