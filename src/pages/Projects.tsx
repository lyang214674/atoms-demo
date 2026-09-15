import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { ProjectSummary } from "../../shared/types";
import { api } from "../api";

const STATUS_LABEL: Record<string, string> = {
  planning: "待规划",
  planned: "待构建",
  building: "构建中",
  done: "已完成",
  failed: "失败",
};

export default function Projects() {
  const [items, setItems] = useState<ProjectSummary[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    try {
      const r = await api.projects();
      setItems(r.projects);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "加载失败");
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function remove(id: string) {
    if (!confirm("删除这个项目及其所有版本？")) return;
    await api.deleteProject(id);
    void load();
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">我的项目</h1>
        <Link to="/" className="rounded-md bg-sky-500 px-3 py-1.5 text-sm font-medium text-slate-950 hover:bg-sky-400">
          新建应用
        </Link>
      </div>
      {err && <p className="mt-4 text-rose-400">{err}</p>}
      {items === null ? (
        <p className="mt-6 text-slate-400">加载中…</p>
      ) : items.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-slate-800 p-10 text-center text-slate-500">
          还没有项目。回到首页描述一个想法，几十秒后它就会出现在这里。
        </div>
      ) : (
        <ul className="mt-6 divide-y divide-slate-800 rounded-xl border border-slate-800">
          {items.map((p) => (
            <li key={p.id} className="flex items-center gap-4 px-4 py-3 hover:bg-slate-900/60">
              <Link to={`/p/${p.id}`} className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium">{p.title}</span>
                  <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">v{p.latest_n}</span>
                  <span className="text-xs text-slate-500">{STATUS_LABEL[p.latest_status] ?? p.latest_status}</span>
                  {p.share_slug && <span className="text-xs text-emerald-400">已分享</span>}
                  {p.forked_from && <span className="text-xs text-violet-400">Remix</span>}
                </div>
                <p className="mt-0.5 truncate text-xs text-slate-500">{p.prompt}</p>
              </Link>
              <span className="hidden text-xs text-slate-500 sm:block">{new Date(p.updated_at).toLocaleString()}</span>
              <button onClick={() => remove(p.id)} className="text-xs text-slate-500 hover:text-rose-400">
                删除
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
