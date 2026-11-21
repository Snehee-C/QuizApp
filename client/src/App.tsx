import type { JSX } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
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
import { ClockDebug } from "./components/ClockDebug";
import { CommandPalette } from "./components/CommandPalette";

// A signed-out visit to a real destination used to end at the dashboard: the
// place you asked for was thrown away at the gate, and after logging in you
// had to go and find it again. A shared "/edit/<id>" link, a bookmark, or a
// session that expired mid-edit all landed in the same wrong room.
//
// So the gate carries the destination with it and Login hands it back. `replace`
// keeps the gate out of history — a bounced visit must not become a page the
// Back button can return to, or Back would bounce them again.
function RequireAuth({ children }: { children: JSX.Element }) {
  const { user } = useAuth();
  const location = useLocation();
  return user ? (
    children
  ) : (
    <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  );
}

export default function App() {
  return (
    <>
      {/* Renders nothing unless `?clock=1` has been used on this device. Here
          rather than inside Present/Play so it survives every branch of both
          — including the error and post-session screens, which are exactly
          where a host goes looking when the room felt unfair. */}
      <ClockDebug />
      {/* ⌘K, on every signed-in page except the presenter's (where a global
          key handler and a projector already own the keyboard). It decides
          for itself whether it is enabled; see the component. */}
      <CommandPalette />
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
    </>
  );
}
