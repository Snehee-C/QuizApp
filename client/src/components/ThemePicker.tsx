import { useRef } from "react";
import { THEMES } from "../lib/themes";
import { cn } from "../lib/cn";

// The stage-theme picker.
//
// Two rules shape this control, and they pull against each other.
//
// 1. It is a COLOUR picker, so colour cannot also be the selection channel
//    (DESIGN.md §5). "The selected one is the lime one" is unreadable when
//    every option is a different colour and one of the themes is lime. So
//    selection is carried by a ring and a check glyph, both of which survive
//    greyscale, and reinforced by the label's weight.
// 2. It is editor chrome read at desk distance, not stage content, so it uses
//    normal UI sizing and the AA contrast target — not the stage scale.
//
// The swatch colours are the only colours here, and they come from the THEMES
// data rather than from literals, so adding a theme needs no edit to this file.

interface ThemePickerProps {
  value: string;
  onChange: (key: string) => void;
  className?: string;
}

export function ThemePicker({ value, onChange, className }: ThemePickerProps) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const selected = THEMES.findIndex((t) => t.key === value);
  // An unrecognised key must still leave exactly one tab stop in the group, so
  // focus falls to the first option rather than vanishing.
  const focusIndex = selected >= 0 ? selected : 0;

  function move(delta: number) {
    const n = THEMES.length;
    const next = (focusIndex + delta + n) % n;
    onChange(THEMES[next].key);
    refs.current[next]?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    // A radio group moves selection with the arrows, in both axes — the
    // swatches wrap onto a second row, so Down must mean the same as Right.
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        e.preventDefault();
        move(1);
        break;
      case "ArrowLeft":
      case "ArrowUp":
        e.preventDefault();
        move(-1);
        break;
      case "Home":
        e.preventDefault();
        move(-focusIndex);
        break;
      case "End":
        e.preventDefault();
        move(THEMES.length - 1 - focusIndex);
        break;
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label="Stage theme"
      onKeyDown={onKeyDown}
      className={cn("flex flex-wrap gap-2", className)}
    >
      {THEMES.map((theme, i) => {
        const isSelected = i === selected;
        const [canvas, accent] = theme.swatch;
        return (
          <button
            key={theme.key}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={isSelected}
            // Roving tabindex: the group is one tab stop, the arrows move
            // within it.
            tabIndex={i === focusIndex ? 0 : -1}
            onClick={() => onChange(theme.key)}
            className={cn(
              "flex flex-col items-center gap-1.5 rounded-md p-2 outline-none select-none",
              "transition-shadow duration-fast ease-standard",
              isSelected
                ? "shadow-[0_0_0_2px_var(--accent)]"
                : "shadow-line hover:shadow-[0_0_0_1px_var(--hairline-str)]",
              "focus-visible:shadow-[0_0_0_2px_var(--accent),var(--focus)]"
            )}
          >
            <span
              aria-hidden="true"
              className="relative block w-16 h-11 rounded-sm overflow-hidden"
              style={{ background: canvas }}
            >
              {/* A bar of the accent over the canvas: the two tokens a theme
                  actually moves, in the proportion the stage uses them. */}
              <span
                className="absolute left-2 bottom-2 h-2 w-6 rounded-pill"
                style={{ background: accent }}
              />
              {isSelected && (
                <span className="absolute inset-0 grid place-items-center">
                  <span className="w-5 h-5 rounded-pill grid place-items-center bg-accent text-accent-ink text-caption font-bold leading-none">
                    ✓
                  </span>
                </span>
              )}
            </span>
            <span
              className={cn(
                "text-caption font-ui",
                isSelected ? "text-ink font-semibold" : "text-ink-muted"
              )}
            >
              {theme.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
