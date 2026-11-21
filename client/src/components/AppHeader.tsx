import type { ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";
import { cn } from "../lib/cn";
import { useAuth } from "../auth";
import { Button } from "./ui/Button";

/**
 * The one header every signed-in page wears.
 *
 * Five pages hand-rolled five headers, and only the dashboard's carried the
 * global links — so Templates and Import were reachable from exactly one place
 * and every cross-journey bounced through the hub (FLOW.md F7, UX-PLAN 0.1).
 * This is DESIGN.md P1 applied to doors: a destination that appears in any
 * header appears in every header, and the next global place costs one edit
 * here instead of five.
 *
 * The page keeps two slots. `crumb` sits after the global nav and names where
 * you are inside the product (the editor's deck title, History's trail);
 * `actions` sits at the right, before the account controls, and carries the
 * page's own verbs. The shell owns nothing a page would want to change.
 */

const NAV: { to: string; label: string }[] = [
  { to: "/dashboard", label: "Decks" },
  { to: "/templates", label: "Templates" },
  // Import only. Export lives on the deck rows, where the deck is.
  { to: "/transfer", label: "Import" },
];

export function AppHeader({
  crumb,
  actions,
  width = "contained",
}: {
  /** Where you are, after the global places. Rendered in a min-w-0 flex row. */
  crumb?: ReactNode;
  /** The page's own verbs, right-aligned before the account controls. */
  actions?: ReactNode;
  /**
   * The list pages share one reading column; the editor is a full-width
   * workspace with no column to align to.
   */
  width?: "contained" | "full";
}) {
  const { user, logout } = useAuth();

  return (
    // The fill is a color-mix, not `bg-canvas/80`: the slash-alpha cannot
    // inject an alpha channel into an `oklch()` token and computes to fully
    // transparent (DESIGN.md §4).
    <header
      className="sticky top-0 z-20 shrink-0 backdrop-blur border-b border-hairline"
      style={{ background: "color-mix(in oklch, var(--canvas), transparent 20%)" }}
    >
      <div
        className={cn(
          "h-16 flex items-center justify-between gap-4",
          width === "contained" ? "max-w-4xl mx-auto px-6" : "px-5"
        )}
      >
        <div className="flex items-center gap-3 min-w-0 flex-1">
          {/* Inside the app, a wordmark means "home" and home is the deck
              list — not the marketing page. */}
          <Link to="/dashboard" className="shrink-0 font-display font-bold text-title3">
            Floodlight
          </Link>

          {/* Styled as the ghost/sm button the dashboard already used for these
              links, so the weight is unchanged — but a real link with
              `aria-current`, which a Button wrapped in a Link cannot carry. The
              current place is marked the way an open menu trigger is marked
              (MoreMenu): one spelling for "this is where you are". */}
          <nav aria-label="Global" className="flex items-center gap-1 shrink-0">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                className={({ isActive }) =>
                  cn(
                    "inline-flex items-center justify-center h-9 px-3.5 rounded-sm",
                    "font-ui font-semibold text-footnote select-none press",
                    "transition-colors duration-fast outline-none focus-visible:shadow-focus",
                    isActive
                      ? "bg-surface-2 text-ink"
                      : "text-ink-muted hover:text-ink hover:bg-surface-1"
                  )
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>

          {crumb && (
            <>
              <span className="shrink-0 w-px h-5 bg-hairline" aria-hidden="true" />
              <div className="flex items-center gap-3 min-w-0 flex-1">{crumb}</div>
            </>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {actions}
          {/* The account label yields to a page crumb. The reading column is
              896px wide and the global nav now takes a third of it; on a page
              that also names a deck (History's trail), the name of the person
              is the least useful thing in the bar and the first to go. It
              stays on the pages that have no crumb, where it always was. */}
          {!crumb && (
            <span className="text-subhead text-ink-subtle hidden sm:block">{user?.name}</span>
          )}
          <Button variant="ghost" size="sm" onClick={logout} title={user ? `Signed in as ${user.name}` : undefined}>
            Log out
          </Button>
        </div>
      </div>
    </header>
  );
}
