import { API_BASE } from "./config";
import { getToken } from "./api";

// One implementation of "download this session's results as CSV".
//
// Three surfaces offered the same file — the history page, the last-run bar
// and the live stage — and the one on the live stage was the only one that
// said nothing when it failed: `if (!res.ok) return;` in front of a room.
// Same shape as `deckFile.ts`: throws with the server's message, and the
// caller decides how loudly to say so.
export async function downloadSessionCsv(sessionId: string, joinCode: string | null): Promise<void> {
  // The endpoint is authenticated, so it cannot be a plain <a href>: the
  // bearer token has to be attached and the browser handed a blob instead.
  const res = await fetch(`${API_BASE}/api/sessions/${sessionId}/export`, {
    headers: { Authorization: `Bearer ${getToken()}` },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as { error?: string });
    throw new Error(body.error || `Export failed (${res.status})`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `session-${joinCode ?? "results"}-results.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
