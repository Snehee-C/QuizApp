import { useEffect, useState } from "react";
import { Input, Label } from "./ui/Card";
import {
  MAX_TIME_LIMIT_SEC,
  MIN_TIME_LIMIT_SEC,
  clampTimeLimitSec,
} from "../lib/timeLimit";

/**
 * A slide's countdown, in seconds.
 *
 * Three quiz types carried their own `<Input type="number">` that wrote
 * `Number(e.target.value)` on every keystroke. Typing `45` saved `4` and then
 * `45`; clearing the field saved `0`; HTML `min`/`max` block nothing while
 * typing, and the server quietly clamped whatever arrived at runtime — so a
 * slide the editor showed as "0 seconds" ran for 5 in front of a room, and
 * nothing ever said so (UX-PLAN 5.2, PULSE T3/T6).
 *
 * So the field is liberal while you type and strict when you leave: the
 * keystrokes live in a local string, nothing persists until blur or Enter,
 * the committed value is clamped to the server's real bounds, and the clamped
 * value is what the field then shows. What is stored is what runs.
 */
export function TimeLimitField({
  id,
  value,
  onCommit,
}: {
  id: string;
  value: unknown;
  onCommit: (seconds: number) => void;
}) {
  const committed = clampTimeLimitSec(value);
  const [text, setText] = useState(String(committed));

  // The slide prop can change under us (undo, a reload) — follow it when we
  // are not mid-edit.
  useEffect(() => {
    setText(String(committed));
  }, [committed]);

  function commit() {
    const next = clampTimeLimitSec(text);
    setText(String(next));
    if (next !== committed) onCommit(next);
  }

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <Label className="mb-0" htmlFor={id}>
        Time limit
      </Label>
      <Input
        id={id}
        type="text"
        inputMode="numeric"
        pattern="[0-9]*"
        className="nums w-24 h-9"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
        }}
      />
      <span className="text-footnote text-ink-subtle">
        seconds · {MIN_TIME_LIMIT_SEC}–{MAX_TIME_LIMIT_SEC}
      </span>
    </div>
  );
}
