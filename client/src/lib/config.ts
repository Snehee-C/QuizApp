// Base URL for the backend.
// - Local dev: uses the same hostname the browser is on, so localhost ->
//   localhost:<port>, and a phone at 192.168.x.x -> 192.168.x.x:<port>.
//   The port defaults to 3000 and can be overridden with VITE_API_PORT
//   (see client/.env.local) when something else already owns 3000.
// - Production: set VITE_API_URL at build time (e.g. https://api.yourdomain.com).
const API_PORT = (import.meta.env.VITE_API_PORT as string | undefined) || "3000";

export const API_BASE =
  (import.meta.env.VITE_API_URL as string | undefined) ||
  `http://${window.location.hostname}:${API_PORT}`;

/** True when the page is being viewed on the host machine itself. */
export function isLoopbackHost(): boolean {
  const h = window.location.hostname;
  return h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "[::1]";
}

/**
 * The origin a PHONE should use to join.
 *
 * A host who opens the presenter at localhost would otherwise show a join link
 * and QR that resolve to the scanning phone itself, so nobody can get in. The
 * server knows the machine's real LAN address, so ask it.
 *
 * Returns null when there is nothing better than what we already have.
 */
export async function resolveJoinOrigin(): Promise<string | null> {
  if (!isLoopbackHost()) return null; // already on a reachable address
  try {
    const res = await fetch(`${API_BASE}/api/network`);
    if (!res.ok) return null;
    const { lan, clientPort } = (await res.json()) as { lan: string[]; clientPort: number };
    if (!lan?.length) return null;
    const port = window.location.port || String(clientPort);
    return `${window.location.protocol}//${lan[0]}:${port}`;
  } catch {
    return null;
  }
}
