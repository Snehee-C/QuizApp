import { cn } from "../../lib/cn";

// Depth comes from the surface ladder plus a 1px hairline — we have no
// drop-shadow system (DESIGN.md §7). `box-shadow: 0 0 0 1px` renders crisper
// than `border` at fractional DPR and doesn't disturb layout.
export function Card({
  level = 1,
  className,
  ...rest
}: React.HTMLAttributes<HTMLDivElement> & { level?: 0 | 1 | 2 | 3 }) {
  return (
    <div
      className={cn(
        "bg-surface-1 rounded-lg",
        level === 0 && "shadow-line",
        level === 1 && "shadow-elev-1",
        level === 2 && "shadow-elev-2",
        level === 3 && "shadow-elev-3",
        className
      )}
      {...rest}
    />
  );
}

export function Input({ className, ...rest }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "w-full bg-surface-2 text-ink placeholder:text-ink-subtle font-ui",
        "rounded-md px-4 h-11 shadow-line outline-none",
        "transition-shadow duration-fast ease-standard",
        "focus:shadow-[var(--line),var(--focus)]",
        className
      )}
      {...rest}
    />
  );
}

export function Label({ className, ...rest }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn(
        "block text-caption font-semibold uppercase track-label text-ink-subtle mb-2",
        className
      )}
      {...rest}
    />
  );
}
