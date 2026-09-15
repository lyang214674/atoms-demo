import type { Context } from "hono";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { Env, Vars } from "./env";
import { now, uid } from "./util";

const SESSION_COOKIE = "atoms_sid";
const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;
// Kept modest on purpose: Workers Free gives 10ms CPU per request.
const PBKDF2_ITERATIONS = 60_000;

const enc = new TextEncoder();

function b64(buf: ArrayBuffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}
function unb64(s: string) {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

async function derive(password: string, salt: Uint8Array) {
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS },
    key,
    256,
  );
  return b64(bits);
}

export async function hashPassword(password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt);
  return { hash, salt: b64(salt.buffer as ArrayBuffer) };
}

export async function verifyPassword(password: string, hash: string, saltB64: string) {
  const computed = await derive(password, unb64(saltB64));
  if (computed.length !== hash.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) diff |= computed.charCodeAt(i) ^ hash.charCodeAt(i);
  return diff === 0;
}

export async function createSession(c: Context<{ Bindings: Env; Variables: Vars }>, userId: string) {
  const id = uid();
  const expires = now() + SESSION_TTL_MS;
  await c.env.DB.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(id, userId, expires)
    .run();
  setCookie(c, SESSION_COOKIE, id, {
    httpOnly: true,
    sameSite: "Lax",
    secure: new URL(c.req.url).protocol === "https:",
    path: "/",
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export async function destroySession(c: Context<{ Bindings: Env; Variables: Vars }>) {
  const sid = getCookie(c, SESSION_COOKIE);
  if (sid) await c.env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(sid).run();
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
}

/** Resolve the current user id from the session cookie (null if anonymous). */
export async function resolveUser(c: Context<{ Bindings: Env; Variables: Vars }>): Promise<string | null> {
  const sid = getCookie(c, SESSION_COOKIE);
  if (!sid) return null;
  const row = await c.env.DB.prepare("SELECT user_id, expires_at FROM sessions WHERE id = ?")
    .bind(sid)
    .first<{ user_id: string; expires_at: number }>();
  if (!row) return null;
  if (row.expires_at < now()) {
    await c.env.DB.prepare("DELETE FROM sessions WHERE id = ?").bind(sid).run();
    return null;
  }
  return row.user_id;
}
