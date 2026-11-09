import { API_BASE } from "./config";
import { getToken } from "./api";

// Saving one deck to a .json file.
//
// This used to live inside the Import/export PAGE, which also meant it was
// only reachable from there: to export a deck you left the deck list, found
// the same deck again in a second list of all your decks, and pressed Download
// next to it. The second list was a copy of the one you had just walked away
// from — the clearest kind of P1 defect, a whole screen as a synonym for a row
// you were already looking at.
//
// So the operation moved to where the deck is, and this module is the single
// implementation both ends share.

/** The server sanitises the title for the filename, so prefer its answer. */
function filenameFromHeader(header: string | null): string | null {
  if (!header) return null;
  const match = /filename="([^"]+)"/.exec(header);
  return match ? match[1] : null;
}

function fallbackFilename(title: string): string {
  const stem = title
    .replace(/[^A-Za-z0-9 _-]+/g, " ")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60);
  return `${stem || "deck"}.json`;
}

/**
 * Download `deckId` as a file. Throws with the server's message on failure, so
 * the caller decides how loudly to say so — a row in a list and a full page
 * have different ideas about that.
 */
export async function exportDeckToFile(deckId: string, title: string): Promise<void> {
  // The endpoint is authenticated, so it cannot be a plain <a href>: the
  // bearer token has to be attached and the browser handed a blob instead.
  const res = await fetch(`${API_BASE}/api/transfer/${deckId}/export`, {
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
  a.download = filenameFromHeader(res.headers.get("Content-Disposition")) ?? fallbackFilename(title);
  a.click();
  URL.revokeObjectURL(url);
}
