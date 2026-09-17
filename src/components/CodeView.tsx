import { useMemo, useState } from "react";

/** Read-only source view of the generated single-file app, with copy / download. */
export function CodeView({ html, fileName }: { html: string; fileName: string }) {
  const [copied, setCopied] = useState(false);
  const lines = useMemo(() => html.split("\n"), [html]);
  const size = useMemo(() => new Blob([html]).size, [html]);

  const copy = () => {
    void navigator.clipboard.writeText(html);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
      <div className="flex items-center gap-2 border-b border-slate-800 px-3 py-2 text-xs text-slate-400">
        <span className="mono truncate">{fileName}</span>
        <span className="text-slate-600">
          {lines.length} 行 · {(size / 1024).toFixed(1)} KB
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button onClick={copy} className="rounded px-2 py-1 hover:bg-slate-800">
            {copied ? "已复制" : "复制"}
          </button>
          <button onClick={download} className="rounded px-2 py-1 hover:bg-slate-800" title="下载为独立可运行的 HTML 文件">
            下载 .html
          </button>
        </div>
      </div>
      <pre className="scroll-thin mono min-h-0 flex-1 overflow-auto p-3 text-[12px] leading-5 text-slate-300">
        {lines.map((l, i) => (
          <div key={i} className="flex">
            <span className="w-10 shrink-0 select-none pr-3 text-right text-slate-600">{i + 1}</span>
            <span className="whitespace-pre">{l}</span>
          </div>
        ))}
      </pre>
    </div>
  );
}
