import { useSyncExternalStore } from "react";
import { Button } from "./Button";
import { cn } from "../../lib/cn";
import { isMuted, subscribeMuted, toggleMuted, unlockAudio } from "../../lib/sound";

// The mute control for the synthesised cue kit (lib/sound.ts).
//
// Sound is an enhancement here, never a channel of its own — every cue has a
// visual equivalent on screen — so this control can be small and quiet. It is
// still a real toggle, not an icon that changes colour: state is carried by
// `aria-pressed`, by the title/label text, AND by the glyph's own silhouette
// (waves present vs. a slash), because DESIGN.md §5 forbids encoding meaning
// in colour alone.
//
// Defaults are set by initSound({ role }) — presenter on, participant off.

function Icon({ on }: { on: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={18}
      height={18}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {/* the speaker body is constant so only the state half of the glyph moves */}
      <path d="M11 5 6 9H3v6h3l5 4V5Z" fill="currentColor" stroke="none" />
      {on ? (
        <>
          <path d="M15.5 8.5a5 5 0 0 1 0 7" />
          <path d="M18.5 5.5a9 9 0 0 1 0 13" />
        </>
      ) : (
        <>
          <path d="M16 9.5 21 15" />
          <path d="M21 9.5 16 15" />
        </>
      )}
    </svg>
  );
}

export function SoundToggle({ className }: { className?: string }) {
  // useSyncExternalStore rather than local state: the mute flag lives in the
  // sound module and can be changed from elsewhere (initSound resolving the
  // role default, a second toggle on another surface).
  const muted = useSyncExternalStore(subscribeMuted, isMuted, () => true);

  const label = muted ? "Sound off" : "Sound on";

  return (
    <Button
      variant="ghost"
      size="sm"
      aria-pressed={!muted}
      aria-label={label}
      title={label}
      className={cn("px-2.5", className)}
      onClick={() => {
        // Prime the context from this gesture. Unmuting and only then waiting
        // for some later click would swallow the next cue.
        unlockAudio();
        toggleMuted();
      }}
    >
      <Icon on={!muted} />
      <span className="sr-only">{label}</span>
    </Button>
  );
}
