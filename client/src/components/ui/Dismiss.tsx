import { cn } from "../../lib/cn";

/**
 * The ✕ on a dialog.
 *
 * Both modals in the product were `aria-modal` with no visible way out:
 * Escape and clicking the scrim worked, but neither is discoverable, and a
 * dialog that offers no door is one you learn to leave by guessing (UX-PLAN
 * 5.9). One spelling for every dialog (DESIGN.md P1): a 44px target, in the
 * corner, named for a screen reader.
 */
export function Dismiss({
  onClick,
  label = "Close",
  className,
}: {
  onClick: () => void;
  label?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        "w-11 h-11 grid place-items-center rounded-sm text-ink-subtle outline-none",
        "hover:text-ink hover:bg-surface-2 transition-colors duration-fast focus-visible:shadow-focus",
        className
      )}
    >
      <span aria-hidden="true" className="text-subhead">
        ✕
      </span>
    </button>
  );
}
