import { useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";

export default function AuthPage() {
  const [mode, setMode] = useState<"register" | "login">("register");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { setUser } = useAuth();
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const next = sp.get("next") || "/projects";

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const user = mode === "register" ? await api.register(email, password) : await api.login(email, password);
      setUser(user);
      nav(next, { replace: true });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-6">
        <div className="flex rounded-lg bg-slate-950 p-1 text-sm">
          {(["register", "login"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`flex-1 rounded-md py-1.5 ${mode === m ? "bg-slate-800 text-white" : "text-slate-400"}`}
            >
              {m === "register" ? "注册" : "登录"}
            </button>
          ))}
        </div>
        <h1 className="mt-5 text-xl font-semibold">{mode === "register" ? "创建账号" : "欢迎回来"}</h1>
        <p className="mt-1 text-sm text-slate-400">
          {mode === "register" ? "只需邮箱和密码，不发验证码。你的项目会保存在账号下。" : "使用注册时的邮箱和密码。"}
        </p>
        <form onSubmit={submit} className="mt-5 space-y-3">
          <label className="block text-sm">
            <span className="text-slate-400">邮箱</span>
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 outline-none focus:border-sky-500"
            />
          </label>
          <label className="block text-sm">
            <span className="text-slate-400">密码（至少 6 位）</span>
            <input
              type="password"
              required
              minLength={6}
              autoComplete={mode === "register" ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 outline-none focus:border-sky-500"
            />
          </label>
          {err && <p className="text-sm text-rose-400">{err}</p>}
          <button
            disabled={busy}
            className="w-full rounded-md bg-sky-500 py-2 font-medium text-slate-950 hover:bg-sky-400 disabled:opacity-50"
          >
            {busy ? "请稍候…" : mode === "register" ? "注册并进入" : "登录"}
          </button>
        </form>
      </div>
    </div>
  );
}
