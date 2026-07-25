import express from "express";
import cors from "cors";
import { createServer } from "http";
import { Server } from "socket.io";

import { authRouter } from "./routes/auth.js";
import { presentationsRouter } from "./routes/presentations.js";
import { sessionsRouter } from "./routes/sessions.js";
import { registerSessionHandlers } from "./sockets/session.js";

const PORT = Number(process.env.PORT) || 3000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "*";

const app = express();
app.use(cors({ origin: true }));
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

app.use("/api/auth", authRouter);
app.use("/api/presentations", presentationsRouter);
app.use("/api/sessions", sessionsRouter);

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: true },
});

io.on("connection", (socket) => {
  registerSessionHandlers(io, socket);
});

httpServer.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server on http://localhost:${PORT}`);
  console.log(`   Health:  http://localhost:${PORT}/api/health`);
  console.log(`   (LAN devices can reach it via http://<your-lan-ip>:${PORT})`);
});
