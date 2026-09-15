import { useEffect, useRef } from "react";
import type { AgentRole, Review } from "../../shared/types";

export type TimelineStep = {
  role: AgentRole;
  label: string;
  status: "running" | "done" | "error";
  detail?: string;
};

const ROLE_META: Record<AgentRole, { name: string; title: string; color: string }> = {
  planner: { name: "Emma", title: "Planner", color: "bg-violet-400" },
  builder: { name: "Alex", title: "Builder", color: "bg-emerald-400" },
  reviewer: { name: "Sarah", title: "Reviewer", color: "bg-amber-400" },
  system: { name: "Mike", title: "Team Lead", color: "bg-sky-400" },
};

export function AgentTimeline({
  steps,
  liveRole,
  liveText,
  review,
}: {
  steps: TimelineStep[];
  liveRole: AgentRole | null;
  liveText: string;
  review?: Review | null;
}) {
  const liveRef = useRef<HTMLPreElement>(null);
  useEffect(() => {
    liveRef.current?.scrollTo({ top: liveRef.current.scrollHeight });
  }, [liveText]);

  return (
    <ol className="space-y-3">
      {steps.map((s, i) => {
        const meta = ROLE_META[s.role];
        const isLive = s.status === "running" && liveRole === s.role;
        return (
          <li key={i} className="rounded-lg border border-slate-800 bg-slate-900/60 p-3">
            <div className="flex items-center gap-2 text-sm">
              <span className={`h-2.5 w-2.5 rounded-full ${meta.color} ${s.status === "running" ? "pulse-dot" : ""}`} />
              <span className="font-medium">{meta.name}</span>
              <span className="text-slate-500">· {meta.title}</span>
              <span className="ml-auto text-xs text-slate-500">
                {s.status === "running" ? "进行中" : s.status === "done" ? "完成" : "失败"}
              </span>
            </div>
            <p className="mt-1 text-sm text-slate-300">{s.label}</p>
            {s.detail && <p className="mt-1 text-xs text-rose-400">{s.detail}</p>}
            {isLive && liveText && (
              <pre
                ref={liveRef}
                className="scroll-thin mono mt-2 max-h-40 overflow-auto rounded bg-slate-950 p-2 text-[11px] leading-relaxed text-slate-400"
              >
                {liveText.slice(-4000)}
              </pre>
            )}
            {s.role === "reviewer" && s.status === "done" && review && <ReviewList review={review} />}
          </li>
        );
      })}
    </ol>
  );
}

export function ReviewList({ review }: { review: Review }) {
  return (
    <div className="mt-2 space-y-1 text-xs">
      {review.checks.map((c, i) => (
        <div key={i} className="flex items-start gap-2">
          <span className={c.ok ? "text-emerald-400" : "text-amber-400"}>{c.ok ? "✓" : "!"}</span>
          <span className="text-slate-300">
            {c.name}
            {c.note && <span className="text-slate-500"> — {c.note}</span>}
          </span>
        </div>
      ))}
      {review.notes && <p className="pt-1 text-slate-400">{review.notes}</p>}
    </div>
  );
}
