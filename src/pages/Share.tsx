import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { Plan, Review } from "../../shared/types";
import { api } from "../api";
import { useAuth } from "../auth";
import { Preview } from "../components/Preview";
import { ReviewList } from "../components/AgentTimeline";

export default function Share() {
  const { slug = "" } = useParams();
  const { user } = useAuth();
  const nav = useNavigate();
  const [data, setData] = useState<{
    project: { title: string; prompt: string; updated_at: number };
    version: { n: number; plan: Plan | null; html: string | null; review: Review | null };
  } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.shared(slug).then(setData).catch((e) => setErr(e.message));
  }, [slug]);

  async function remix() {
    if (!user) {
      nav(`/auth?next=${encodeURIComponent(`/s/${slug}`)}`);
      return;
    }
    setBusy(true);
    try {
      const { project } = await api.remix(slug);
      nav(`/p/${project.id}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Remix 失败");
    } finally {
      setBusy(false);
    }
  }

  if (err) {
    return (
      <div className="mx-auto max-w-xl px-4 py-20 text-center">
        <p className="text-slate-300">{err}</p>
        <Link to="/" className="mt-4 inline-block text-sky-400">
          返回首页
        </Link>
      </div>
    );
  }
  if (!data) return <div className="p-10 text-slate-400">加载中…</div>;

  return (
    <div className="mx-auto grid max-w-7xl gap-6 px-4 py-8 lg:grid-cols-[320px_1fr]">
      <aside className="space-y-4">
        <div>
          <p className="text-xs text-slate-500">公开分享 · v{data.version.n}</p>
          <h1 className="mt-1 text-2xl font-semibold">{data.version.plan?.app_name ?? data.project.title}</h1>
          <p className="mt-2 text-sm text-slate-400">{data.version.plan?.summary}</p>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
          <h4 className="text-xs uppercase tracking-wide text-slate-500">原始需求</h4>
          <p className="mt-1 text-sm text-slate-300">{data.project.prompt}</p>
        </div>
        {data.version.plan && (
          <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
            <h4 className="text-xs uppercase tracking-wide text-slate-500">功能</h4>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-slate-300">
              {data.version.plan.features.map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
          </div>
        )}
        {data.version.review && (
          <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
            <h4 className="text-xs uppercase tracking-wide text-slate-500">Reviewer 检查</h4>
            <ReviewList review={data.version.review} />
          </div>
        )}
        <button
          onClick={remix}
          disabled={busy}
          className="w-full rounded-md bg-violet-500 py-2 text-sm font-medium text-white hover:bg-violet-400 disabled:opacity-50"
        >
          {busy ? "复制中…" : user ? "Remix 到我的项目并继续修改" : "注册后 Remix 这个应用"}
        </button>
        <p className="text-xs text-slate-500">Remix 会把这个版本复制到你的账号，你可以继续用对话修改它。</p>
      </aside>
      <div className="h-[75vh] min-h-[480px]">
        <Preview html={data.version.html} rawUrl={`/raw/s/${slug}`} storageKey={`share:${slug}`} />
      </div>
    </div>
  );
}
