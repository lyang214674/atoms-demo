import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import type { AgentRole, Plan, Project, Review, StreamEvent, Version } from "../../shared/types";
import { api, streamAgent } from "../api";
import { AgentTimeline, ReviewList, type TimelineStep } from "../components/AgentTimeline";
import { PlanCard } from "../components/PlanCard";
import { Preview } from "../components/Preview";

export default function Workspace() {
  const { id = "" } = useParams();
  const [sp, setSp] = useSearchParams();

  const [project, setProject] = useState<Project | null>(null);
  const [versions, setVersions] = useState<Version[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<TimelineStep[]>([]);
  const [liveRole, setLiveRole] = useState<AgentRole | null>(null);
  const [liveText, setLiveText] = useState("");
  const [liveHtml, setLiveHtml] = useState<string | null>(null);
  const [liveReview, setLiveReview] = useState<Review | null>(null);
  const [runVersionId, setRunVersionId] = useState<string | null>(null);

  const [message, setMessage] = useState("");
  const [shareBusy, setShareBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const selected = useMemo(() => versions.find((v) => v.id === selectedId) ?? null, [versions, selectedId]);
  const latest = versions[versions.length - 1] ?? null;

  const load = useCallback(async () => {
    const r = await api.project(id);
    setProject(r.project);
    setVersions(r.versions);
    return r;
  }, [id]);

  useEffect(() => {
    load()
      .then((r) => {
        const last = r.versions[r.versions.length - 1];
        setSelectedId(last?.id ?? null);
      })
      .catch((e) => setErr(e.message));
  }, [load]);

  const upsertVersion = useCallback((v: Version) => {
    setVersions((list) => {
      const i = list.findIndex((x) => x.id === v.id);
      if (i === -1) return [...list, v].sort((a, b) => a.n - b.n);
      const copy = list.slice();
      copy[i] = v;
      return copy;
    });
  }, []);

  const handleEvent = useCallback(
    (e: StreamEvent) => {
      switch (e.type) {
        case "step_start":
          setLiveRole(e.role);
          setLiveText("");
          setSteps((s) => [...s, { role: e.role, label: e.label, status: "running" }]);
          break;
        case "token":
          setLiveText((t) => t + e.text);
          break;
        case "step_done":
          setSteps((s) => s.map((st, i) => (i === s.length - 1 ? { ...st, status: "done", label: e.label } : st)));
          setLiveRole(null);
          break;
        case "html":
          setLiveHtml(e.html);
          break;
        case "review":
          setLiveReview(e.review);
          break;
        case "version":
          upsertVersion(e.version);
          break;
        case "error":
          setSteps((s) => {
            if (!s.length || s[s.length - 1].status !== "running") {
              return [...s, { role: "system", label: "执行失败", status: "error", detail: e.message }];
            }
            return s.map((st, i) => (i === s.length - 1 ? { ...st, status: "error", detail: e.message } : st));
          });
          setLiveRole(null);
          break;
        case "plan":
        case "end":
          break;
      }
    },
    [upsertVersion],
  );

  const runPlan = useCallback(
    async (vid: string) => {
      setRunning(true);
      setErr(null);
      setSteps([]);
      setLiveHtml(null);
      setLiveReview(null);
      setRunVersionId(vid);
      setSelectedId(vid);
      const ac = new AbortController();
      abortRef.current = ac;
      try {
        await streamAgent(`/api/versions/${vid}/plan`, {}, handleEvent, ac.signal);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "规划失败");
      } finally {
        setRunning(false);
        void load();
      }
    },
    [handleEvent, load],
  );

  const runBuild = useCallback(
    async (vid: string, plan: Plan) => {
      setRunning(true);
      setErr(null);
      setLiveHtml(null);
      setLiveReview(null);
      setRunVersionId(vid);
      setSelectedId(vid);
      const ac = new AbortController();
      abortRef.current = ac;
      try {
        await streamAgent(`/api/versions/${vid}/build`, { plan }, handleEvent, ac.signal);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "构建失败");
      } finally {
        setRunning(false);
        void load();
      }
    },
    [handleEvent, load],
  );

  // Auto-start planning for a freshly created project (?auto=1).
  useEffect(() => {
    if (!latest || running) return;
    if (sp.get("auto") === "1" && latest.status === "planning") {
      sp.delete("auto");
      setSp(sp, { replace: true });
      void runPlan(latest.id);
    }
  }, [latest, running, sp, setSp, runPlan]);

  async function iterate(e: FormEvent) {
    e.preventDefault();
    const m = message.trim();
    if (m.length < 2 || running) return;
    setMessage("");
    try {
      const { version } = await api.iterate(id, m);
      upsertVersion(version);
      await runPlan(version.id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "发起修改失败");
    }
  }

  async function share() {
    setShareBusy(true);
    try {
      const { share_slug } = await api.share(id);
      setProject((p) => (p ? { ...p, share_slug } : p));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "分享失败");
    } finally {
      setShareBusy(false);
    }
  }
  async function unshare() {
    setShareBusy(true);
    try {
      await api.unshare(id);
      setProject((p) => (p ? { ...p, share_slug: null } : p));
    } finally {
      setShareBusy(false);
    }
  }
  function copyShare() {
    if (!project?.share_slug) return;
    void navigator.clipboard.writeText(`${location.origin}/s/${project.share_slug}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  if (err && !project) {
    return (
      <div className="mx-auto max-w-xl px-4 py-20 text-center">
        <p className="text-slate-300">{err}</p>
        <Link to="/projects" className="mt-4 inline-block text-sky-400">
          回到我的项目
        </Link>
      </div>
    );
  }
  if (!project) return <div className="p-10 text-slate-400">加载中…</div>;

  const showingRun = running || (runVersionId && selectedId === runVersionId && steps.length > 0);
  const previewHtml = showingRun && liveHtml ? liveHtml : selected?.html ?? (showingRun ? liveHtml : null);
  const isBuilding = running && liveRole === "builder";
  const needsConfirm = !running && selected && selected.status === "planned" && selected.plan && !selected.html;
  const hasDone = versions.some((v) => v.status === "done");

  return (
    <div className="mx-auto grid h-[calc(100vh-56px)] max-w-[1600px] grid-cols-1 gap-4 px-4 py-4 lg:grid-cols-[minmax(340px,420px)_1fr]">
      {/* left: conversation / agents */}
      <section className="flex min-h-0 flex-col rounded-xl border border-slate-800 bg-slate-900/40">
        <header className="flex items-center gap-2 border-b border-slate-800 px-4 py-3">
          <Link to="/projects" className="text-xs text-slate-500 hover:text-white">
            ← 项目
          </Link>
          <h1 className="min-w-0 flex-1 truncate font-semibold">{project.title}</h1>
          {project.forked_from && <span className="text-xs text-violet-400">Remix</span>}
        </header>

        <div className="scroll-thin min-h-0 flex-1 space-y-4 overflow-auto p-4">
          {/* original prompt */}
          <div className="rounded-lg bg-sky-500/10 p-3 text-sm">
            <p className="text-xs text-sky-400">你的需求</p>
            <p className="mt-1 text-slate-200">{project.prompt}</p>
          </div>

          {/* versions */}
          {versions.length > 0 && (
            <div>
              <p className="mb-2 text-xs uppercase tracking-wide text-slate-500">版本</p>
              <div className="flex flex-wrap gap-2">
                {versions.map((v) => (
                  <button
                    key={v.id}
                    onClick={() => !running && setSelectedId(v.id)}
                    title={v.user_message}
                    className={`rounded-md border px-2.5 py-1 text-xs ${
                      v.id === selectedId ? "border-sky-500 bg-sky-500/10 text-white" : "border-slate-700 text-slate-400 hover:border-slate-500"
                    }`}
                  >
                    v{v.n} · {statusLabel(v.status)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* selected version details */}
          {selected && (
            <div className="space-y-3">
              {selected.n > 1 && (
                <div className="rounded-lg bg-slate-800/60 p-3 text-sm">
                  <p className="text-xs text-slate-500">v{selected.n} 的修改要求</p>
                  <p className="mt-1 text-slate-200">{selected.user_message}</p>
                </div>
              )}

              {showingRun && steps.length > 0 && (
                <AgentTimeline steps={steps} liveRole={liveRole} liveText={liveText} review={liveReview} />
              )}

              {selected.plan && (
                <PlanCard
                  key={selected.id + selected.status}
                  plan={selected.plan}
                  editable={Boolean(needsConfirm)}
                  busy={running}
                  onConfirm={(plan) => runBuild(selected.id, plan)}
                />
              )}

              {!showingRun && selected.review && selected.status === "done" && (
                <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
                  <p className="text-xs uppercase tracking-wide text-slate-500">Reviewer 检查结果</p>
                  <ReviewList review={selected.review} />
                </div>
              )}

              {!running && selected.status === "planning" && (
                <button onClick={() => runPlan(selected.id)} className="rounded-md bg-violet-500 px-3 py-1.5 text-sm text-white hover:bg-violet-400">
                  开始规划
                </button>
              )}
              {!running && selected.status === "failed" && (
                <div className="flex gap-2">
                  <button onClick={() => runPlan(selected.id)} className="rounded-md border border-slate-700 px-3 py-1.5 text-sm hover:bg-slate-800">
                    重新规划
                  </button>
                  {selected.plan && (
                    <button onClick={() => runBuild(selected.id, selected.plan!)} className="rounded-md bg-emerald-500 px-3 py-1.5 text-sm text-slate-950 hover:bg-emerald-400">
                      重新构建
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {err && <p className="text-sm text-rose-400">{err}</p>}
        </div>

        {/* iterate */}
        <form onSubmit={iterate} className="border-t border-slate-800 p-3">
          <div className="flex items-end gap-2 rounded-lg border border-slate-700 bg-slate-950 p-2 focus-within:border-sky-500">
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  (e.currentTarget.form as HTMLFormElement).requestSubmit();
                }
              }}
              rows={2}
              disabled={running || !hasDone}
              placeholder={hasDone ? "继续修改，例如：加一个深色模式；把按钮改成圆角…" : "先完成第一次构建，再继续修改"}
              className="flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-slate-600 disabled:opacity-50"
            />
            <button
              disabled={running || !hasDone || message.trim().length < 2}
              className="rounded-md bg-sky-500 px-3 py-1.5 text-sm font-medium text-slate-950 hover:bg-sky-400 disabled:opacity-40"
            >
              发送
            </button>
          </div>
          <p className="mt-1 text-[11px] text-slate-500">每次修改会生成一个新版本；Planner 先更新计划，你确认后 Builder 再改代码。</p>
        </form>
      </section>

      {/* right: preview */}
      <section className="flex min-h-[480px] flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-slate-400">
            预览 {selected ? `v${selected.n}` : ""} {isBuilding && <span className="text-sky-400">· 构建中</span>}
          </span>
          <div className="ml-auto flex items-center gap-2">
            {project.share_slug ? (
              <>
                <Link to={`/s/${project.share_slug}`} className="rounded-md border border-slate-700 px-3 py-1.5 hover:bg-slate-800">
                  查看分享页
                </Link>
                <button onClick={copyShare} className="rounded-md border border-slate-700 px-3 py-1.5 hover:bg-slate-800">
                  {copied ? "已复制" : "复制链接"}
                </button>
                <button onClick={unshare} disabled={shareBusy} className="rounded-md px-2 py-1.5 text-xs text-slate-500 hover:text-rose-400">
                  取消分享
                </button>
              </>
            ) : (
              <button
                onClick={share}
                disabled={shareBusy || !hasDone}
                title={hasDone ? "生成公开链接，任何人可打开运行并 Remix" : "先完成一次构建"}
                className="rounded-md bg-emerald-500 px-3 py-1.5 font-medium text-slate-950 hover:bg-emerald-400 disabled:opacity-40"
              >
                {shareBusy ? "发布中…" : "分享"}
              </button>
            )}
          </div>
        </div>
        <div className="min-h-0 flex-1">
          <Preview
            html={previewHtml}
            building={isBuilding}
            rawUrl={selected?.html ? `/raw/v/${selected.id}` : null}
            emptyHint={
              selected?.status === "failed"
                ? "这一版生成失败了，原因见左侧时间线。点「重新构建」再来一次，失败不扣配额。"
                : selected?.status === "planning"
                  ? "Planner 正在拆解需求…"
                  : undefined
            }
          />
        </div>
      </section>
    </div>
  );
}

function statusLabel(s: Version["status"]) {
  return { planning: "规划中", planned: "待确认", building: "构建中", done: "完成", failed: "失败" }[s];
}
