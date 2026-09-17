import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import {
  AUTH_ATTEMPT_SQL,
  AUTH_MAX_ATTEMPTS,
  AUTH_WINDOW_MS,
  QUOTA_RESERVE_SQL,
  authAttemptArgs,
  originAllowed,
  quotaReserveArgs,
  triagePrompt,
} from "../worker/policy.ts";

function freshDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../migrations/0001_init.sql", import.meta.url), "utf8"));
  db.exec(readFileSync(new URL("../migrations/0002_auth_attempts.sql", import.meta.url), "utf8"));
  return db;
}

test("triage: questions and vague prompts are asked to clarify, real requests build", () => {
  assert.equal(triagePrompt("什么是番茄钟？").kind, "clarify");
  assert.equal(triagePrompt("你觉得哪个框架好？").kind, "clarify");
  assert.equal(triagePrompt("做一个应用").kind, "clarify");
  assert.equal(triagePrompt("帮我做个网站吧").kind, "clarify");
  assert.equal(triagePrompt("app").kind, "clarify");
  assert.equal(triagePrompt("做一个番茄钟，可以设置专注时长，记录今天完成了几个番茄").kind, "build");
  assert.equal(triagePrompt("待办清单，可添加、勾选、删除").kind, "build");
  assert.equal(triagePrompt("一个极简记账本：记录收入支出、按月汇总").kind, "build");
});

test("quota: per-user cap, global cap, atomic reservation", () => {
  const db = freshDb();
  const reserve = (user: string, day = "2026-09-17", userLimit = 3, globalLimit = 5) =>
    db.prepare(QUOTA_RESERVE_SQL).run(...quotaReserveArgs(user, day, userLimit, globalLimit)).changes;

  assert.equal(reserve("a"), 1);
  assert.equal(reserve("a"), 1);
  assert.equal(reserve("a"), 1);
  assert.equal(reserve("a"), 0, "4th call for user a hits the per-user cap");
  assert.equal(reserve("b"), 1);
  assert.equal(reserve("b"), 1);
  assert.equal(reserve("b"), 0, "global cap (5) reached across users");
  assert.equal(reserve("c"), 0, "new user still blocked by global cap");
  assert.equal(reserve("a", "2026-09-18"), 1, "next day resets");

  const row = db.prepare("SELECT SUM(count) AS total FROM usage_daily WHERE day = ?").get("2026-09-17") as { total: number };
  assert.equal(row.total, 5);
});

test("quota: single-statement reservation never overshoots under interleaving", () => {
  const db = freshDb();
  // Simulate many callers racing for a global cap of 4.
  let ok = 0;
  for (let i = 0; i < 50; i++) {
    ok += db.prepare(QUOTA_RESERVE_SQL).run(...quotaReserveArgs(`u${i % 7}`, "d", 100, 4)).changes;
  }
  assert.equal(ok, 4);
});

test("auth throttle: fixed window counts and resets", () => {
  const db = freshDb();
  const t0 = 1_000_000;
  const hit = (now: number) => (db.prepare(AUTH_ATTEMPT_SQL).get(...authAttemptArgs("login:1.2.3.4", now)) as { count: number }).count;

  for (let i = 1; i <= AUTH_MAX_ATTEMPTS; i++) assert.equal(hit(t0 + i), i);
  assert.equal(hit(t0 + 100) > AUTH_MAX_ATTEMPTS, true, "11th attempt inside the window is over the limit");
  assert.equal(hit(t0 + AUTH_WINDOW_MS + 1000), 1, "a new window starts at 1");
  assert.equal((db.prepare(AUTH_ATTEMPT_SQL).get(...authAttemptArgs("login:9.9.9.9", t0)) as { count: number }).count, 1, "keys are independent");
});

test("origin check: same origin and local dev pass, foreign origins fail", () => {
  const url = "https://atoms.example.com/api/projects";
  assert.equal(originAllowed(undefined, url), true);
  assert.equal(originAllowed("https://atoms.example.com", url), true);
  assert.equal(originAllowed("http://localhost:5173", url), true);
  assert.equal(originAllowed("https://evil.example.net", url), false);
  assert.equal(originAllowed("not a url", url), false);
});
