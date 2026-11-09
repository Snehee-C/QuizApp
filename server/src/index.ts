import express from "express";
import cors from "cors";
import { createServer } from "http";
import { networkInterfaces } from "os";
import { Server } from "socket.io";

import { authRouter } from "./routes/auth.js";
import { presentationsRouter } from "./routes/presentations.js";
import { sessionsRouter } from "./routes/sessions.js";
import { transferRouter } from "./routes/transfer.js";
import { initSessionRuntime, liveSessionCount, registerSessionHandlers } from "./sockets/session.js";

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
// A deck export with notes on every slide comfortably exceeds the 100KB
// default, and body-parser rejects it with a 413 before any route runs.
app.use(express.json({ limit: "2mb" }));

// The address other devices on this network should use. The presenter page
// needs it because a host who opens the app at "localhost" would otherwise
// print a join link and QR code that resolve to the phone's OWN machine —
// the single most common way a live session fails to let anyone in.
function lanAddresses(): { address: string; iface: string }[] {
  const found: { address: string; iface: string }[] = [];
  for (const [iface, addrs] of Object.entries(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family !== "IPv4" || a.internal) continue;
      // Link-local means DHCP failed — not a usable LAN address.
      if (a.address.startsWith("169.254.")) continue;
      found.push({ address: a.address, iface });
    }
  }

  // A machine with VPN or virtualisation software has several IPv4 addresses
  // and only one of them is the Wi-Fi the audience is on. Handing out the
  // wrong one produces a join link that silently reaches nobody, so rank
  // rather than taking whatever the OS happened to enumerate first:
  //   * physical interfaces (en/eth/wlan) beat tun/utun/bridge/vmnet
  //   * an address ending .0 is a network address, which a real DHCP lease on
  //     a /24 never is — a reliable tell for a virtual adapter
  const physical = /^(en|eth|wlan|wlp|enp)\d/i;
  const score = (e: { address: string; iface: string }) =>
    (physical.test(e.iface) ? 0 : 2) + (e.address.endsWith(".0") ? 1 : 0);

  return found.sort((a, b) => score(a) - score(b) || a.iface.localeCompare(b.iface));
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    time: new Date().toISOString(),
    lan: lanAddresses().map((e) => e.address),
    // Rooms held in memory right now. Not a session list and not a count of
    // anything a user owns — just the size of the cache, so its eviction is
    // observable from outside the process.
    liveSessions: liveSessionCount(),
  });
});

// Served to the presenter so it can build a join URL that works off-machine.
app.get("/api/network", (_req, res) => {
  // Best candidate first; the full list is returned so a host on a machine
  // with several networks can be told which one was chosen.
  const ranked = lanAddresses();
  res.json({
    lan: ranked.map((e) => e.address),
    interfaces: ranked,
    clientPort: Number(process.env.CLIENT_PORT) || 5173,
  });
});

app.use("/api/auth", authRouter);
app.use("/api/presentations", presentationsRouter);
app.use("/api/sessions", sessionsRouter);
app.use("/api/transfer", transferRouter);

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: corsOrigin },
});

// Recovery and housekeeping have to run with no socket in sight: a process
// that has just come up owns every ACTIVE session in the database, including
// the rooms a previous process was mid-way through. This also closes sessions
// an older process abandoned before recovery existed — honestly, with a real
// endedAt, never by deleting anything.
initSessionRuntime(io);

io.on("connection", (socket) => {
  registerSessionHandlers(io, socket);
});

// Socket.IO does not catch rejections from async event handlers, so a single
// unexpected database error would otherwise terminate the process and drop
// every live room. Log loudly and stay up — a crashed server mid-session is
// far more costly than a handler that failed.
process.on("unhandledRejection", (reason) => {
  console.error("[unhandledRejection]", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err);
});

httpServer.listen(PORT, "0.0.0.0", () => {
  const lan = lanAddresses();
  console.log(`API on http://localhost:${PORT}`);
  for (const e of lan) console.log(`   LAN: http://${e.address}:${PORT}  (${e.iface})`);
  if (lan.length === 0) {
    console.log("   No LAN address found — others will not be able to join.");
  }
});
