// Stage theme — see DESIGN.md §5.
//
// A projector cannot display black: in a lit room its "black" is ambient light
// reflected off the screen, so a dark stage that measures 18:1 on a monitor can
// collapse to ~4:1 in a lecture hall with the lights on. The presenter picks
// the room condition in one tap from the lobby; the choice persists per host.
//
// The participant's phone is ALWAYS Stage Dark — it's held 40cm from the face
// in a room that is usually dim, and a white phone screen in a dark auditorium
// is hostile.

export type Stage = "dark" | "light";

const KEY = "floodlight_stage";

export function getStage(): Stage {
  const v = localStorage.getItem(KEY);
  return v === "light" ? "light" : "dark";
}

export function setStage(stage: Stage) {
  localStorage.setItem(KEY, stage);
  applyStage(stage);
}

/**
 * Stage Light is opt-in per surface: it's set on a container element, not on
 * <html>, so the presenter view can run light while the rest of the app (and
 * any participant view in the same browser) stays dark.
 */
export function applyStage(stage: Stage, el?: HTMLElement | null) {
  const target = el ?? document.documentElement;
  if (stage === "light") target.setAttribute("data-stage", "light");
  else target.removeAttribute("data-stage");
}
