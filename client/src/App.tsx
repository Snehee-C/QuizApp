import type { JSX } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth";
import Login from "./presenter/Login";
import Dashboard from "./presenter/Dashboard";
import Editor from "./presenter/Editor";
import Present from "./presenter/Present";
import Join from "./participant/Join";
import Play from "./participant/Play";
import Home from "./Home";
import History from "./presenter/History";
import Templates from "./presenter/Templates";
import DeckTransfer from "./presenter/DeckTransfer";

function RequireAuth({ children }: { children: JSX.Element }) {
  const { user } = useAuth();
  return user ? children : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<Login />} />

      {/* Presenter (auth required) */}
      <Route
        path="/dashboard"
        element={
          <RequireAuth>
            <Dashboard />
          </RequireAuth>
        }
      />
      <Route
        path="/edit/:id"
        element={
          <RequireAuth>
            <Editor />
          </RequireAuth>
        }
      />
      <Route
        path="/templates"
        element={
          <RequireAuth>
            <Templates />
          </RequireAuth>
        }
      />
      <Route
        path="/transfer"
        element={
          <RequireAuth>
            <DeckTransfer />
          </RequireAuth>
        }
      />
      <Route
        path="/history/:id"
        element={
          <RequireAuth>
            <History />
          </RequireAuth>
        }
      />
      <Route
        path="/present/:id"
        element={
          <RequireAuth>
            <Present />
          </RequireAuth>
        }
      />

      {/* Participant (no auth) */}
      <Route path="/join" element={<Join />} />
      <Route path="/join/:code" element={<Play />} />

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
