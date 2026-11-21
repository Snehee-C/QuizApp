import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "motion/react";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Card";
import { spring } from "../lib/motion";
import {
  CODE_LENGTH,
  peekErrorCopy,
  peekSession,
  sanitizeCode,
  type JoinState,
  type PeekErrorCode,
} from "./joinCode";

/**
 * How long six typed digits sit before they submit themselves. Long enough
 * that a paste's single change event and a fast typist's last keystroke do
 * not race the navigation; short enough to feel like the field did it.
 */
const AUTO_SUBMIT_MS = 150;

export default function Join() {
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  // Pre-filled from wherever this screen was reached FROM: the room screen
  // bouncing a bad code back here (`state`), or a link carrying `?code=`.
  // Five correct digits used to be thrown away on every error (UX-PLAN 3.1).
  const incoming = (location.state ?? null) as JoinState | null;
  const [code, setCode] = useState(() => sanitizeCode(incoming?.code ?? params.get("code") ?? ""));
  const [error, setError] = useState<PeekErrorCode | null>(incoming?.error ?? null);
  const [checking, setChecking] = useState(false);
  // What the last check was FOR, so a stale ack cannot land on a newer code.
  const inFlight = useRef<string | null>(null);

  const check = useCallback(
    async (candidate: string) => {
      if (candidate.length < CODE_LENGTH || inFlight.current === candidate) return;
      inFlight.current = candidate;
      setChecking(true);
      setError(null);
      const res = await peekSession(candidate);
      if (inFlight.current !== candidate) return;
      inFlight.current = null;
      setChecking(false);
      if (res.ok) {
        navigate(`/join/${candidate}`);
        return;
      }
      // The code stays in the field: the error is about it, and the person
      // needs to see which digit to fix.
      setError(res.code);
    },
    [navigate]
  );

  // Auto-submit at six digits (UX-PLAN 3.3). The numeric keypad on iOS has no
  // Go key and the button can sit under it, so the field finishes the job on
  // its own. The button stays for anyone who wants it, and for a code that
  // was refused and is being resent unchanged.
  useEffect(() => {
    if (code.length < CODE_LENGTH || error) return;
    const t = window.setTimeout(() => void check(code), AUTO_SUBMIT_MS);
    return () => window.clearTimeout(t);
  }, [code, error, check]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    inFlight.current = null;
    void check(code);
  }

  const copy = error ? peekErrorCopy(error) : null;

  return (
    <div className="h-[100dvh] flex items-center justify-center px-6 bg-canvas text-ink">
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-0"
        style={{
          background:
            "radial-gradient(760px 420px at 50% -12%, var(--accent-a18) 0%, transparent 62%)",
        }}
      />
      <motion.form
        initial={{ opacity: 0, y: 22 }}
        animate={{ opacity: 1, y: 0 }}
        transition={spring.slow}
        onSubmit={submit}
        className="relative z-10 w-full max-w-sm flex flex-col gap-6 text-center"
      >
        <h1 className="font-display text-large-title font-bold leading-tight">
          Enter your join code
        </h1>
        {/* No `maxLength`: it truncated BEFORE the sanitiser ran, so a pasted
            `157 770` became `15777`. Strip, then cap, then show the result. */}
        <Input
          className="code h-20 text-center text-display font-bold rounded-lg"
          placeholder="000000"
          value={code}
          onChange={(e) => {
            setCode(sanitizeCode(e.target.value));
            setError(null);
          }}
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          aria-label="Six digit join code"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "join-error" : undefined}
        />
        {copy && (
          <div id="join-error" role="alert" className="flex flex-col gap-1">
            <p className="text-body font-semibold text-warn">{copy.title}</p>
            <p className="text-subhead text-ink-muted">{copy.hint}</p>
          </div>
        )}
        <Button
          type="submit"
          variant="primary"
          size="xl"
          disabled={code.length < CODE_LENGTH || checking}
        >
          {checking ? "Checking…" : "Join"}
        </Button>
      </motion.form>
    </div>
  );
}
