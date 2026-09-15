import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./auth";
import { Shell } from "./components/Shell";
import Home from "./pages/Home";
import AuthPage from "./pages/Auth";
import Projects from "./pages/Projects";
import Workspace from "./pages/Workspace";
import Share from "./pages/Share";

function RequireUser({ children }: { children: React.ReactElement }) {
  const { user, loading } = useAuth();
  const loc = useLocation();
  if (loading) return <div className="p-10 text-slate-400">加载中…</div>;
  if (!user) return <Navigate to={`/auth?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  return children;
}

export default function App() {
  return (
    <Shell>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/auth" element={<AuthPage />} />
        <Route path="/s/:slug" element={<Share />} />
        <Route
          path="/projects"
          element={
            <RequireUser>
              <Projects />
            </RequireUser>
          }
        />
        <Route
          path="/p/:id"
          element={
            <RequireUser>
              <Workspace />
            </RequireUser>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  );
}
