import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, type Presentation } from "../lib/api";
import { formatRelative } from "../lib/relativeTime";
import { MoreMenu, type MoreAction } from "./MoreMenu";

/**
 * The editor's deck title, as a switcher.
 *
 * Switching is not choosing (FLOW.md F7): moving between two decks you already
 * know by name should not pass through a list you have to scan. Every
 * document editor has this menu; ours lists the five decks touched most
 * recently, then `All decks…` for the long tail (UX-PLAN 0.4).
 *
 * It carries the `· live` marker when this deck has a room open, so a host
 * cannot switch away from a live deck without the trigger itself saying so.
 */
export function DeckSwitcher({ currentId, live }: { currentId: string; live: boolean }) {
  const navigate = useNavigate();
  const [decks, setDecks] = useState<Presentation[]>([]);

  // The server returns the list newest-updated first (presentations.ts), so
  // "recent" is the head of it with this deck taken out.
  useEffect(() => {
    let ok = true;
    api
      .listPresentations()
      .then((d) => ok && setDecks(d))
      .catch(() => {
        // A failed fetch costs the recents; `All decks…` still works.
      });
    return () => {
      ok = false;
    };
  }, [currentId]);

  const recent = decks.filter((d) => d.id !== currentId).slice(0, 5);

  // MoreMenu keys its rows by label, and two decks can share a title
  // ("Untitled deck" is the default). Suffix the repeats so the rows stay
  // distinct — to React and to the host.
  const seen = new Map<string, number>();
  const actions: MoreAction[] = recent.map((d) => {
    const n = (seen.get(d.title) ?? 0) + 1;
    seen.set(d.title, n);
    return {
      label: n === 1 ? d.title : `${d.title} (${n})`,
      detail: formatRelative(d.updatedAt),
      onSelect: () => navigate(`/edit/${d.id}`),
    };
  });
  actions.push({ label: "All decks…", onSelect: () => navigate("/dashboard") });

  return (
    <MoreMenu
      label={live ? "Switch deck — this deck is live" : "Switch deck"}
      triggerLabel={
        <span className="inline-flex items-center gap-1.5">
          {live && <span className="text-accent font-semibold">· live</span>}
          <span>▾</span>
        </span>
      }
      actions={actions}
    />
  );
}
