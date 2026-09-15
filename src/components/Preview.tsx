import { useEffect, useMemo, useState } from "react";
import { STORAGE_MSG_TYPE, injectStorageShim } from "../../shared/storageShim";

type Device = "desktop" | "mobile";

const storeKey = (k: string) => `atoms:appdata:${k}`;

function loadAppData(k: string): Record<string, string> {
  try {
    const raw = localStorage.getItem(storeKey(k));
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export function Preview({
  html,
  rawUrl,
  building,
  emptyHint,
  storageKey,
}: {
  html: string | null;
  rawUrl?: string | null;
  building?: boolean;
  emptyHint?: string;
  /** Namespace for the generated app's persisted data (e.g. project id). */
  storageKey?: string;
}) {
  const [device, setDevice] = useState<Device>("desktop");
  const [nonce, setNonce] = useState(0);

  // The generated app's localStorage lives in *our* localStorage, namespaced per project.
  useEffect(() => {
    if (!storageKey) return;
    const onMsg = (ev: MessageEvent) => {
      const d = ev.data as { type?: string; data?: Record<string, string> } | null;
      if (!d || d.type !== STORAGE_MSG_TYPE || !d.data) return;
      try {
        localStorage.setItem(storeKey(storageKey), JSON.stringify(d.data));
      } catch {
        // storage full / disabled — ignore
      }
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [storageKey]);

  const doc = useMemo(() => {
    if (!html) return null;
    return injectStorageShim(html, storageKey ? loadAppData(storageKey) : {});
    // nonce is intentionally a dependency: "刷新" should re-read persisted data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html, storageKey, nonce]);

  const resetData = () => {
    if (!storageKey) return;
    localStorage.removeItem(storeKey(storageKey));
    setNonce((n) => n + 1);
  };

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-slate-800 bg-slate-900">
      <div className="flex items-center gap-2 border-b border-slate-800 px-3 py-2 text-xs text-slate-400">
        <span className="flex gap-1">
          <i className="h-2.5 w-2.5 rounded-full bg-slate-700" />
          <i className="h-2.5 w-2.5 rounded-full bg-slate-700" />
          <i className="h-2.5 w-2.5 rounded-full bg-slate-700" />
        </span>
        <span className="ml-2 truncate mono">{building ? "building…" : html ? "preview" : "no build yet"}</span>
        <div className="ml-auto flex items-center gap-1">
          <button onClick={() => setDevice("desktop")} className={chip(device === "desktop")} title="桌面宽度">
            桌面
          </button>
          <button onClick={() => setDevice("mobile")} className={chip(device === "mobile")} title="375px 手机宽度">
            手机
          </button>
          <button onClick={() => setNonce((n) => n + 1)} className={chip(false)} title="重新加载预览" disabled={!html}>
            刷新
          </button>
          {storageKey && (
            <button onClick={resetData} className={chip(false)} title="清空这个应用保存的数据" disabled={!html}>
              清空数据
            </button>
          )}
          {rawUrl && html && (
            <a href={rawUrl} target="_blank" rel="noreferrer" className={chip(false)} title="在新标签页全屏打开">
              新标签打开
            </a>
          )}
        </div>
      </div>
      <div className="relative flex flex-1 items-stretch justify-center overflow-hidden bg-[radial-gradient(circle_at_1px_1px,rgb(30_41_59)_1px,transparent_0)] [background-size:16px_16px]">
        {doc ? (
          <iframe
            key={nonce}
            title="生成的应用预览"
            sandbox="allow-scripts allow-forms allow-modals allow-popups"
            srcDoc={doc}
            className={`h-full bg-white transition-all ${device === "mobile" ? "my-3 w-[375px] rounded-2xl border border-slate-700 shadow-xl" : "w-full"}`}
          />
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-slate-500">
            {building ? (
              <>
                <span className="pulse-dot inline-block h-3 w-3 rounded-full bg-sky-400" />
                <p>Builder 正在写代码，完成后这里会直接运行你的应用</p>
              </>
            ) : (
              <p>{emptyHint ?? "确认计划后开始构建，生成的应用会在这里运行"}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function chip(active: boolean) {
  return `rounded px-2 py-1 ${active ? "bg-slate-700 text-white" : "hover:bg-slate-800 disabled:opacity-40"}`;
}
