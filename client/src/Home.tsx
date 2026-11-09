import { Link } from "react-router-dom";
import { motion } from "motion/react";
import { useAuth } from "./auth";
import { Button } from "./components/ui/Button";
import { slotFor } from "./lib/answers";
import { Shape } from "./components/ui/Shape";

export default function Home() {
  const { user } = useAuth();

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

        <motion.p
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.14, ease: [0, 0, 0.2, 1] }}
          className="text-ink-muted text-hero-sub max-w-2xl balance"
        >
          Live polls, word clouds and quizzes that your audience answers from their
          phones — results landing on the big screen as they vote.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.22, ease: [0, 0, 0.2, 1] }}
          className="flex flex-col sm:flex-row gap-3.5 mt-1"
        >
          <Link to={user ? "/dashboard" : "/login"}>
            <Button variant="primary" size="xl" className="w-full sm:w-auto">
              {user ? "Go to dashboard" : "Host a session"}
            </Button>
          </Link>
          <Link to="/join">
            <Button variant="secondary" size="xl" className="w-full sm:w-auto">
              I have a code
            </Button>
          </Link>
        </motion.div>
      </main>
    </div>
  );
}
