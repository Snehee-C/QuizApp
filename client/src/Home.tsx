import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import { useAuth } from "./auth";
import { Button } from "./components/ui/Button";
import { Input } from "./components/ui/Card";
import { slotFor } from "./lib/answers";
import { Shape } from "./components/ui/Shape";
import { CODE_LENGTH, sanitizeCode } from "./participant/joinCode";

/** Same debounce as the Join screen: a paste's one change event must not race the navigation. */
const AUTO_SUBMIT_MS = 150;

// Players outnumber hosts ~30:1, and a typed arrival — someone who read six
// digits off a wall and opened the site — used to find a hero line, a pitch
// and a button that leads to the field. The field is the product for them, so
// it leads (UX-PLAN 3.6); hosting is the secondary path. The code is checked
// on the room screen, before the nickname, and a bad one comes back to `/join`
// with the digits intact.
export default function Home() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [code, setCode] = useState("");

  useEffect(() => {
    if (code.length < CODE_LENGTH) return;
    const t = window.setTimeout(() => navigate(`/join/${code}`), AUTO_SUBMIT_MS);
    return () => window.clearTimeout(t);
  }, [code, navigate]);

  return (
    <div className="min-h-[100dvh] flex flex-col bg-canvas text-ink overflow-hidden">
      <div
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 z-0"
        style={{
          background:
            "radial-gradient(900px 520px at 50% -10%, var(--accent-a18) 0%, transparent 60%)",
        }}
      />

      <main className="relative z-10 flex-1 flex flex-col items-center justify-center gap-9 px-6 text-center">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0, 0, 0.2, 1] }}
          className="flex items-center gap-2.5"
        >
          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              className="grid place-items-center rounded-md w-9 h-9"
              style={{ background: slotFor(i).fill, color: slotFor(i).ink }}
            >
              <Shape shape={slotFor(i).shape} size={16} />
            </span>
          ))}
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 22 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.06, ease: [0, 0, 0.2, 1] }}
          className="font-display font-bold text-hero max-w-5xl balance"
        >
          Every phone in the room,
          <br className="hidden sm:inline" />
          <span className="text-accent">pointed at your screen.</span>
        </motion.h1>

        <motion.form
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.14, ease: [0, 0, 0.2, 1] }}
          onSubmit={(e) => {
            e.preventDefault();
            if (code.length === CODE_LENGTH) navigate(`/join/${code}`);
          }}
          className="w-full max-w-sm flex flex-col gap-3"
        >
          <label
            htmlFor="home-code"
            className="text-caption font-semibold uppercase track-label text-ink-subtle"
          >
            Got a code? Enter it to play
          </label>
          <Input
            id="home-code"
            className="code h-16 text-center text-title1 font-bold rounded-lg"
            placeholder="000000"
            value={code}
            onChange={(e) => setCode(sanitizeCode(e.target.value))}
            inputMode="numeric"
            autoComplete="one-time-code"
            aria-label="Six digit join code"
          />
          <Button type="submit" variant="primary" size="xl" disabled={code.length < CODE_LENGTH}>
            Join the game
          </Button>
        </motion.form>

        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.22, ease: [0, 0, 0.2, 1] }}
          className="flex flex-col items-center gap-3"
        >
          <p className="text-ink-muted text-subhead max-w-2xl balance">
            Live polls, word clouds and quizzes your audience answers from their phones —
            results landing on the big screen as they vote.
          </p>
          <Link to={user ? "/dashboard" : "/login"}>
            <Button variant="secondary" size="lg">
              {user ? "Go to dashboard" : "Host a session"}
            </Button>
          </Link>
        </motion.div>
      </main>
    </div>
  );
}
