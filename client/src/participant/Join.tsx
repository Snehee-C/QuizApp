import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Card";
import { spring } from "../lib/motion";

export default function Join() {
  const [code, setCode] = useState("");
  const navigate = useNavigate();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const clean = code.trim();
    if (clean) navigate(`/join/${clean}`);
  }

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
        <Input
          className="code h-20 text-center text-display font-bold rounded-lg"
          placeholder="000000"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={6}
          autoFocus
          aria-label="Six digit join code"
        />
        <Button type="submit" variant="primary" size="xl" disabled={code.length < 6}>
          Join
        </Button>
      </motion.form>
    </div>
  );
}
