import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import "./index.css";
import App from "./App";
import { AuthProvider } from "./auth";
import { ErrorBoundary } from "./ErrorBoundary";

// HashRouter (not BrowserRouter): GitHub Pages is static hosting with no
// server-side history fallback, so a deep link like /join/123456 would 404
// on refresh with a normal router. Hash-based routing (/#/join/123456)
// sidesteps that entirely — the server only ever sees a request for "/".
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <HashRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </HashRouter>
    </ErrorBoundary>
  </StrictMode>
);
