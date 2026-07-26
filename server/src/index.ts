import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server } from "socket.io";

import { authRouter } from "./routes/auth.js";
import { presentationsRouter } from "./routes/presentations.js";
import { sessionsRouter } from "./routes/sessions.js";
import { registerSessionHandlers } from "./sockets/session.js";

const PORT = Number(process.env.PORT) || 3000;

// Restrict cross-origin access to the configured client origin(s). CLIENT_ORIGIN
// may be a comma-separated list (e.g. prod GitHub Pages + a staging origin).
// When unset (local dev), fall back to reflecting any origin so LAN/phone
// testing keeps working.
const allowedOrigins = process.env.CLIENT_ORIGIN
  ? process.env.CLIENT_ORIGIN.split(",").map((o) => o.trim()).filter(Boolean)
  : null;
const corsOrigin: boolean | string[] = allowedOrigins ?? true;

const app = express();
// Render (and most PaaS) put the app behind a reverse proxy, so the client IP
// is in X-Forwarded-For. Trust one proxy hop so req.ip is accurate for rate
// limiting.
app.set("trust proxy", 1);
app.use(cors({ origin: corsOrigin }));
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

app.use("/api/auth", authRouter);
app.use("/api/presentations", presentationsRouter);
app.use("/api/sessions", sessionsRouter);

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: corsOrigin },
});

io.on("connection", (socket) => {
  registerSessionHandlers(io, socket);
});

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server on http://localhost:${PORT}`);
  console.log(`   Health:  http://localhost:${PORT}/api/health`);
  console.log(`   (LAN devices can reach it via http://<your-lan-ip>:${PORT})`);
});
