import { useState } from "react";
import type { Plan } from "../../shared/types";

export function PlanCard({
  plan,
  editable,
  onConfirm,
  busy,
}: {
  plan: Plan;
  editable: boolean;
  onConfirm?: (plan: Plan) => void;
  busy?: boolean;
}) {
  const [draft, setDraft] = useState<Plan>(plan);
  const [editing, setEditing] = useState(false);

  const list = (label: string, key: "features" | "sections" | "data_model") => (
    <div>
      <h4 className="text-xs uppercase tracking-wide text-slate-500">{label}</h4>
      {editing ? (
        <textarea
          className="mono mt-1 w-full rounded border border-slate-700 bg-slate-950 p-2 text-xs"
          rows={Math.max(3, draft[key].length)}
          value={draft[key].join("\n")}
          onChange={(e) => setDraft({ ...draft, [key]: e.target.value.split("\n").filter((s) => s.trim()) })}
        />
      ) : (
        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-slate-300">
          {draft[key].map((f, i) => (
            <li key={i}>{f}</li>
          ))}
        </ul>
      )}
    </div>
  );

  return (
    <div className="rounded-lg border border-violet-500/30 bg-violet-500/5 p-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          {editing ? (
            <input
              className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 font-semibold"
              value={draft.app_name}
              onChange={(e) => setDraft({ ...draft, app_name: e.target.value })}
            />
          ) : (
            <h3 className="truncate text-lg font-semibold">{draft.app_name}</h3>
          )}
          <p className="mt-1 text-sm text-slate-400">{draft.summary}</p>
        </div>
        {editable && (
          <button onClick={() => setEditing((v) => !v)} className="text-xs text-slate-400 hover:text-white">
            {editing ? "完成编辑" : "编辑计划"}
          </button>
        )}
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        {list("功能", "features")}
        {list("页面结构", "sections")}
        {list("数据（localStorage）", "data_model")}
        <div>
          <h4 className="text-xs uppercase tracking-wide text-slate-500">风格</h4>
          <p className="mt-1 text-sm text-slate-300">{draft.style}</p>
        </div>
      </div>
      {editable && onConfirm && (
        <div className="mt-4 flex items-center gap-3">
          <button
            disabled={busy}
            onClick={() => onConfirm(draft)}
            className="rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
          >
            确认计划，开始构建
          </button>
          <span className="text-xs text-slate-500">你可以先编辑功能清单，再交给 Builder</span>
        </div>
      )}
    </div>
  );
}
