import { forwardRef } from "react";
import { cn } from "../../lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg" | "xl";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

// Size carries its own step on the type ladder, its own radius, and its own
// gap — one decision per size rather than three at the call site (DESIGN.md
// P5). Radius climbs with the element so a 36px control and a 64px one do not
// share a corner (P4).
const SIZES: Record<Size, string> = {
  sm: "h-9 px-3.5 text-footnote rounded-sm gap-1.5",
  md: "h-11 px-5 text-subhead rounded-md gap-2",
  lg: "h-13 px-7 text-body rounded-lg gap-2.5",
  xl: "h-16 px-9 text-title3 rounded-xl gap-3",
};

// Hover is a brightness change, not a colour change — Linear's trick, and it
// means a variant needs only one colour defined, not two.
const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-accent text-accent-ink brighten disabled:bg-surface-2 disabled:text-ink-subtle",
  secondary: "bg-surface-2 text-ink shadow-line brighten disabled:text-ink-subtle",
  ghost: "bg-transparent text-ink-muted hover:text-ink hover:bg-surface-1 disabled:text-ink-subtle",
  danger:
    "bg-transparent text-danger hover:bg-[color-mix(in_oklch,var(--danger),transparent_88%)] disabled:text-ink-subtle",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", className, ...rest },
  ref
) {
  return (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center font-ui font-semibold",
        "transition-[transform,filter,background-color,color] duration-instant ease-standard",
        "disabled:pointer-events-none select-none",
        // One press behaviour product-wide (DESIGN.md P1): the element
        // responds where it is. Nothing travels down a drawn shadow.
        "press",
        SIZES[size],
        VARIANTS[variant],
        className
      )}
      {...rest}
    />
  );
});
