import { Link, NavLink, useNavigate } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth } from "../auth";

export function Shell({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  return (
    <div className="min-h-full flex flex-col">
      <header className="sticky top-0 z-20 border-b border-slate-800 bg-slate-950/80 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4">
          <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="inline-block h-5 w-5 rounded-full bg-sky-400 ring-4 ring-sky-400/20" />
            Atoms Demo
          </Link>
          <nav className="ml-4 hidden items-center gap-1 text-sm sm:flex">
            <NavLink to="/" end className={({ isActive }) => navCls(isActive)}>
              首页
            </NavLink>
            {user && (
              <NavLink to="/projects" className={({ isActive }) => navCls(isActive)}>
                我的项目
              </NavLink>
            )}
          </nav>
          <div className="ml-auto flex items-center gap-2 text-sm">
            {user ? (
              <>
                <span className="hidden text-slate-400 sm:inline">{user.email}</span>
                <button
                  onClick={async () => {
                    await logout();
                    nav("/");
                  }}
                  className="rounded-md border border-slate-700 px-3 py-1.5 hover:bg-slate-800"
                >
                  退出
                </button>
              </>
            ) : (
              <Link to="/auth" className="rounded-md bg-sky-500 px-3 py-1.5 font-medium text-slate-950 hover:bg-sky-400">
                注册 / 登录
              </Link>
            )}
          </div>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}

function navCls(active: boolean) {
  return `rounded-md px-3 py-1.5 ${active ? "bg-slate-800 text-white" : "text-slate-400 hover:text-white"}`;
}
