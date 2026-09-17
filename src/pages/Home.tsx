import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { GalleryItem } from "../../shared/types";
import { ApiError, api } from "../api";
import { useAuth } from "../auth";

const EXAMPLES = [
  "做一个番茄钟，可以设置专注时长，记录今天完成了几个番茄",
  "一个极简记账本：记录收入支出、按月汇总、可以删除",
  "抽签小工具：输入一组名字，随机抽一个，记录历史结果",
  "习惯打卡：添加习惯，每天打勾，显示连续天数",
  "单词卡片：添加单词和释义，翻牌复习，标记已掌握",
];

export default function Home() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [gallery, setGallery] = useState<GalleryItem[]>([]);

  useEffect(() => {
    api.gallery().then((r) => setGallery(r.items)).catch(() => {});
  }, []);

  async function start() {
    const p = prompt.trim();
    if (p.length < 4) {
      setErr("再多描述一点你想做的应用");
      return;
    }
    if (!user) {
      sessionStorage.setItem("pending_prompt", p);
      nav(`/auth?next=${encodeURIComponent("/")}`);
      return;
    }
    setBusy(true);
    setErr(null);
    setHint(null);
    try {
      const { project } = await api.createProject(p);
      nav(`/p/${project.id}?auto=1`);
    } catch (e) {
      // 422 = the server asked for a clearer prompt; show it as guidance, not failure.
      setHint(e instanceof ApiError && e.status === 422 ? e.message : null);
      setErr(e instanceof ApiError && e.status === 422 ? null : e instanceof Error ? e.message : "创建失败");
    } finally {
      setBusy(false);
    }
  }

  // After registering, resume the prompt the visitor typed before.
  useEffect(() => {
    const pending = sessionStorage.getItem("pending_prompt");
    if (user && pending) {
      sessionStorage.removeItem("pending_prompt");
      setPrompt(pending);
    }
  }, [user]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-12">
      <section className="text-center">
        <p className="text-sm font-medium text-sky-400">Planner · Builder · Reviewer 三个智能体为你工作</p>
        <h1 className="mt-3 text-4xl font-bold tracking-tight sm:text-5xl">一句话，生成一个能用的小应用</h1>
        <p className="mx-auto mt-4 max-w-2xl text-slate-400">
          描述你的想法，AI 团队先出计划等你确认，再写出完整代码并自检；生成的应用直接在页面里运行，可以继续改、保存版本、分享给别人 Remix。
        </p>
        <div className="mx-auto mt-8 max-w-3xl rounded-2xl border border-slate-800 bg-slate-900 p-3 text-left shadow-2xl shadow-sky-500/5">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void start();
            }}
            rows={3}
            placeholder="例如：做一个番茄钟，可以设置专注时长，记录今天完成了几个番茄"
            className="w-full resize-none bg-transparent p-2 text-base outline-none placeholder:text-slate-600"
          />
          <div className="flex flex-wrap items-center gap-2 border-t border-slate-800 px-2 pt-3">
            <span className="text-xs text-slate-500">试试：</span>
            {EXAMPLES.slice(0, 3).map((ex) => (
              <button
                key={ex}
                onClick={() => setPrompt(ex)}
                className="truncate rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-300 hover:border-slate-500"
              >
                {ex.split("，")[0].split("：")[0]}
              </button>
            ))}
            <button
              onClick={start}
              disabled={busy}
              className="ml-auto rounded-lg bg-sky-500 px-5 py-2 text-sm font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-50"
            >
              {busy ? "创建中…" : user ? "开始生成" : "注册并开始生成"}
            </button>
          </div>
          {err && <p className="px-2 pt-2 text-sm text-rose-400">{err}</p>}
          {hint && <p className="px-2 pt-2 text-sm text-amber-300">{hint}</p>}
        </div>
        <p className="mt-3 text-xs text-slate-500">⌘/Ctrl + Enter 直接开始 · 免费注册，无需验证码</p>
      </section>

      <section className="mt-16 grid gap-4 sm:grid-cols-3">
        {[
          ["1. 计划", "Planner 把想法拆成功能清单、页面结构和数据模型，你可以修改后再确认。"],
          ["2. 构建", "Builder 流式写出一个完整的单文件应用，右侧预览立刻可用。"],
          ["3. 审查与迭代", "Reviewer 逐项检查；不满意就继续对话，每次都是新版本，可回滚、可分享。"],
        ].map(([t, d]) => (
          <div key={t} className="rounded-xl border border-slate-800 bg-slate-900/50 p-5">
            <h3 className="font-semibold">{t}</h3>
            <p className="mt-2 text-sm text-slate-400">{d}</p>
          </div>
        ))}
      </section>

      <section className="mt-16">
        <div className="flex items-end justify-between">
          <div>
            <h2 className="text-xl font-semibold">作品墙</h2>
            <p className="text-sm text-slate-400">大家公开分享的应用，点开即可运行，也可以 Remix 成你自己的</p>
          </div>
        </div>
        {gallery.length === 0 ? (
          <div className="mt-4 rounded-xl border border-dashed border-slate-800 p-8 text-center text-sm text-slate-500">
            还没有公开作品。生成一个应用后点「分享」，它就会出现在这里。
          </div>
        ) : (
          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {gallery.map((g) => (
              <Link
                key={g.share_slug}
                to={`/s/${g.share_slug}`}
                className="group overflow-hidden rounded-xl border border-slate-800 bg-slate-900/50 transition hover:border-slate-600"
              >
                <div className="h-36 overflow-hidden bg-white">
                  <iframe
                    title={g.title}
                    src={`/raw/s/${g.share_slug}`}
                    sandbox="allow-scripts"
                    loading="lazy"
                    tabIndex={-1}
                    className="pointer-events-none h-[288px] w-[200%] origin-top-left scale-50"
                  />
                </div>
                <div className="p-4">
                  <h3 className="truncate font-medium group-hover:text-sky-300">{g.app_name ?? g.title}</h3>
                  <p className="mt-1 line-clamp-2 text-xs text-slate-500">{g.prompt}</p>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
