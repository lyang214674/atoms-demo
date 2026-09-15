import type { GalleryItem, Plan, Project, ProjectSummary, StreamEvent, User, Version, Review } from "../shared/types";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    credentials: "same-origin",
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) throw new ApiError(res.status, json.error ?? `请求失败 (${res.status})`);
  return json as T;
}

export const api = {
  me: () => req<{ user: User | null }>("/api/me"),
  register: (email: string, password: string) =>
    req<User>("/api/auth/register", { method: "POST", body: JSON.stringify({ email, password }) }),
  login: (email: string, password: string) =>
    req<User>("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  logout: () => req<{ ok: true }>("/api/auth/logout", { method: "POST" }),

  projects: () => req<{ projects: ProjectSummary[] }>("/api/projects"),
  createProject: (prompt: string) =>
    req<{ project: Project; version: Version }>("/api/projects", { method: "POST", body: JSON.stringify({ prompt }) }),
  project: (id: string) => req<{ project: Project; versions: Version[] }>(`/api/projects/${id}`),
  renameProject: (id: string, title: string) =>
    req<{ project: Project }>(`/api/projects/${id}`, { method: "PATCH", body: JSON.stringify({ title }) }),
  deleteProject: (id: string) => req<{ ok: true }>(`/api/projects/${id}`, { method: "DELETE" }),
  iterate: (id: string, message: string) =>
    req<{ version: Version }>(`/api/projects/${id}/iterate`, { method: "POST", body: JSON.stringify({ message }) }),
  share: (id: string) => req<{ share_slug: string }>(`/api/projects/${id}/share`, { method: "POST" }),
  unshare: (id: string) => req<{ ok: true }>(`/api/projects/${id}/share`, { method: "DELETE" }),

  gallery: () => req<{ items: GalleryItem[] }>("/api/gallery"),
  shared: (slug: string) =>
    req<{
      project: { title: string; prompt: string; share_slug: string; updated_at: number };
      version: { n: number; plan: Plan | null; html: string | null; review: Review | null; created_at: number };
    }>(`/api/share/${slug}`),
  remix: (slug: string) => req<{ project: Project }>(`/api/remix/${slug}`, { method: "POST" }),
};

/**
 * POST to an SSE endpoint and invoke `onEvent` for each event.
 * Resolves when the server sends {type:"end"} or the stream closes.
 */
export async function streamAgent(path: string, body: unknown, onEvent: (e: StreamEvent) => void, signal?: AbortSignal) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
    credentials: "same-origin",
    signal,
  });
  if (!res.ok) {
    const text = await res.text();
    let msg = `请求失败 (${res.status})`;
    try {
      msg = JSON.parse(text).error ?? msg;
    } catch {
      /* noop */
    }
    throw new ApiError(res.status, msg);
  }
  if (!res.body) throw new ApiError(500, "服务端没有返回流");
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let sep: number;
    while ((sep = buf.indexOf("\n\n")) !== -1) {
      const chunk = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      for (const line of chunk.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data) continue;
        try {
          const ev = JSON.parse(data) as StreamEvent;
          onEvent(ev);
          if (ev.type === "end") return;
        } catch {
          /* ignore malformed */
        }
      }
    }
  }
}
