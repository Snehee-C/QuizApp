import { getParticipantId, getSocket } from "../lib/socket";

/**
 * Everything three screens agree on about a join code, in one place: how a
 * typed or pasted code is read, how a code is checked before anyone is asked
 * for a nickname, and what each refusal says.
 *
 * PULSE T6 — liberal with people: `157 770` out of a chat, `Join with code
 * 157770` out of an email and `157770` off the wall are all the same six
 * digits. The field used to run `maxLength={6}` BEFORE the sanitiser, so the
 * first paste became `15777` and the second became nothing at all, silently.
 * Strip first, cap second, and show the result so the person sees what was
 * understood.
 */
export const CODE_LENGTH = 6;

export function sanitizeCode(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, CODE_LENGTH);
}

export type PeekErrorCode = "BAD_CODE" | "SESSION_ENDED" | "RATE_LIMITED" | "UNREACHABLE";

export interface PeekOk {
  ok: true;
  title?: string;
  status?: string;
}
export interface PeekFail {
  ok: false;
  code: PeekErrorCode;
}

/** How long to wait for the server before calling the check unreachable. */
const PEEK_TIMEOUT_MS = 5000;

/**
 * Ask the server whether `code` is a room a player can walk into — before
 * the nickname step, so a wrong digit costs nothing already typed
 * (UX-PLAN 3.1). A read, never a join.
 *
 * Resolves, never rejects: every outcome is a thing a screen has to say.
 * `UNREACHABLE` is this client's own verdict (no ack inside the timeout), and
 * it is distinct from `BAD_CODE` on purpose — "we couldn't check" must not be
 * shown as "that code is wrong".
 */
export function peekSession(code: string): Promise<PeekOk | PeekFail> {
  return new Promise((resolve) => {
    getSocket()
      .timeout(PEEK_TIMEOUT_MS)
      .emit(
        "session:peek",
        { joinCode: code, participantId: getParticipantId() },
        (err: unknown, res: any) => {
          if (err || !res) return resolve({ ok: false, code: "UNREACHABLE" });
          if (res.ok) return resolve({ ok: true, title: res.title, status: res.status });
          const c = res.code;
          resolve({
            ok: false,
            code:
              c === "BAD_CODE" || c === "SESSION_ENDED" || c === "RATE_LIMITED"
                ? c
                : // A server that predates the event answers nothing (timeout
                  // above) or an unknown code; neither is the player's fault.
                  "UNREACHABLE",
          });
        }
      );
  });
}

/**
 * The copy for each refusal, in one place so the Join screen and the room
 * screen cannot drift apart. Branches on the CODE, not the server's wording.
 *
 * `RATE_LIMITED` deliberately does not suggest trying another code — that is
 * exactly the wrong advice to someone who has just been throttled for trying
 * too many.
 */
export function peekErrorCopy(code: PeekErrorCode): { title: string; hint: string } {
  switch (code) {
    case "BAD_CODE":
      return {
        title: "That code doesn't match a game",
        hint: "Check the six digits on the big screen and try again.",
      };
    case "SESSION_ENDED":
      return {
        title: "That game has ended",
        hint: "If the host starts another one, they'll show a new code.",
      };
    case "RATE_LIMITED":
      return {
        title: "Too many tries",
        hint: "Give it a minute, then enter the code again.",
      };
    default:
      return {
        title: "Couldn't check that code",
        hint: "Looks like a connection problem — try again in a moment.",
      };
  }
}

/** What `/join` reads off `location.state` when another screen sends someone back to it. */
export interface JoinState {
  code?: string;
  error?: PeekErrorCode;
}
