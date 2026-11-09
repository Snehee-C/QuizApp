import type { SlideServerDef } from "./types.js";

// Spin the wheel (server half).
//
// This is a HOST-DRIVEN randomiser, not a question: the room watches the
// presenter spin, nobody submits anything, and there is no result to tally.
// So it is modelled as non-interactive, which is what makes the socket layer
// reject `participant:submit` and skip arming a reveal timer — the same
// treatment the content group gets.
//
// The draw itself deliberately lives on the client. Moving it here would mean
// the wheel animation had to chase a server-chosen index over the socket, and
// a dropped frame or a late packet would land the pointer on a different name
// than the one announced. The outcome has no score attached and nothing is
// persisted against it, so there is nothing for a client-side RNG to cheat.

export const spinWheel: SlideServerDef = {
  type: "SPIN_WHEEL",
  interactive: false,

  // Required by the contract but unreachable: a non-interactive slide never
  // accumulates responses. Returning the empty shape rather than throwing
  // keeps a stray aggregate recompute from taking down a live session.
  aggregate: () => ({ type: "SPIN_WHEEL", total: 0 }),
};
