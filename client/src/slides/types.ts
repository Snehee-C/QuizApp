// The slide-type contract (client half).
//
// Every slide type is a self-contained module implementing this interface and
// registered in ./registry.ts. Nothing outside a module should switch on
// `slide.type` — adding a type must mean adding a file, not editing the
// editor, the player and the stage.

import type { ComponentType } from "react";

export interface SlideLike {
  id: string;
  type: string;
  question: string;
  config: any;
}

export interface EditorProps {
  config: any;
  /** Shallow-merges a patch into config and saves. */
  onChange: (patch: any) => void;
  /** Replaces config wholesale — for edits that must remove keys. */
  onReplace: (config: any) => void;
  /**
   * Remove a row from a list field with a way back. The row leaves at once;
   * the write waits out the same six-second undo window a slide delete gets
   * (FLOW.md "Deleting something, with a way back"), and undo re-inserts it
   * into the config AS IT THEN IS, so an edit made meanwhile is kept.
   *
   * Optional on the shell side: a module falls back to `onChange(apply(c))`
   * when it is absent, which is the one-press-irreversible behaviour this
   * replaces (UX-PLAN 5.3).
   */
  onRemove?: (removal: Removal) => void;
  question: string;
}

export interface Removal {
  /** What the undo bar says left: "option B", "accepted answer 2". */
  label: string;
  /** The config with the row gone. Applied now, saved after the window. */
  apply: (config: any) => any;
  /** The row put back at its index in whatever the config has become. */
  restore: (config: any) => any;
}

export interface PlayerProps {
  slide: SlideLike;
  /**
   * Hand the shell an answer. Resolves `true` once the server has accepted
   * it and `false` when it was refused or abandoned, so a module that shows
   * the pick optimistically can put the board back on failure. The return is
   * optional on both sides: a module may ignore it, and an older shell may
   * return nothing — which a module must read as "no verdict", never as
   * failure.
   */
  onSubmit: (value: unknown) => void | Promise<boolean>;
  disabled?: boolean;
  /**
   * The player's OWN previously stored answer, echoed back by the server on
   * the join ack (`myAnswer`). Absent is the normal case — a fresh question —
   * and a module must behave exactly as it always has when it is.
   *
   * Present means the response is already banked: the module should render a
   * read-only echo of this pick INSTEAD of its input, never a pre-filled one.
   * `participant:submit` upserts, so a live control here lets one stray tap
   * replace a scored answer with a late, zero-point one. Pass `disabled`
   * alongside it for exactly that reason: a module whose coercion of `value`
   * fails falls back to its normal input, and that fallback must be inert.
   *
   * Typed `unknown` deliberately. It is a round-trip of whatever was stored,
   * so it is only as well-formed as that slide's `validate` was on the day the
   * row was written, and a deck edited between sessions can hand a module an
   * option index that no longer exists. Coerce it (see ./answeredEcho.ts
   * helpers) and fall back rather than trusting its shape.
   *
   * It must NOT be rendered as correct or incorrect — the reveal owns that,
   * and `value` is available before the reveal fires.
   */
  value?: unknown;
}

export interface StageProps {
  slide: SlideLike;
  /** Null until the first response arrives. */
  aggregate: any;
  revealed: boolean;
  /** Everything the server sent with `slide:reveal`, minus the aggregate. */
  reveal?: Record<string, any> | null;
}

export interface RevealProps {
  slide: SlideLike;
  reveal: Record<string, any>;
  /** The player's own graded result, if they answered in time. */
  feedback: { isQuiz: boolean; correct?: boolean; points?: number } | null;
}

export type SlideGroup = "interactive" | "quiz" | "content";

export interface SlideTypeDef {
  /** Wire value, e.g. "RANKING". Must match the server module's `type`. */
  type: string;
  label: string;
  /** One line shown in the editor's add-slide list. */
  hint: string;
  group: SlideGroup;

  /** Content slides take no answers and show no results. */
  interactive: boolean;

  /** Fresh config for a newly created slide of this type. */
  defaultConfig: () => any;

  /** The question field's placeholder — content slides often want different wording. */
  questionLabel?: string;
  questionPlaceholder?: string;

  /** Type-specific settings panel in the editor. */
  Editor: ComponentType<EditorProps>;

  /** What the player sees and interacts with. Null for content slides. */
  Player: ComponentType<PlayerProps> | null;

  /**
   * True when `Player` renders a read-only echo for `PlayerProps.value` rather
   * than ignoring it. The shell needs this to be a declared fact, not a guess:
   * a module that does not implement `value` still renders its full input when
   * handed one, which inside a "locked in" card would be noise at best. So the
   * shell only routes `value` to a Player that advertises this, and shows its
   * own plain lock card for everything else. Omitted means "no echo", which is
   * why every untouched module keeps working unchanged.
   */
  echoesValue?: boolean;

  /** What the big screen shows. */
  Stage: ComponentType<StageProps>;

  /** Optional: what the player sees after the answer is revealed. */
  Reveal?: ComponentType<RevealProps>;

  /** Optional: miniature shown in the editor's phone preview. */
  Preview?: ComponentType<{ config: any; question: string }>;
}
