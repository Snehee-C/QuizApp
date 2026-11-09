import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "motion/react";
import { useAuth } from "../auth";
import { Button } from "../components/ui/Button";
import { Input, Label } from "../components/ui/Card";
import { spring } from "../lib/motion";

export default function Login() {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { login, signup } = useAuth();
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      if (mode === "login") await login(email, password);
      else await signup(email, password, name);
      navigate("/dashboard");
    } catch (err: any) {
      setError(err.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-[100dvh] flex items-center justify-center px-6 py-10 bg-canvas text-ink">
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
        onSubmit={handleSubmit}
        className="relative z-10 w-full max-w-sm flex flex-col gap-5"
      >
        <h1 className="font-display text-title1 font-bold leading-tight text-center mb-1">
          {mode === "login" ? "Welcome back" : "Create your account"}
        </h1>

        {mode === "signup" && (
          <div>
            <Label htmlFor="name">Name</Label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required autoComplete="name" />
          </div>
        )}
        <div>
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
          />
        </div>
        <div>
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
          />
        </div>

        {error && (
          <p role="alert" className="text-subhead font-medium text-danger">
            {error}
          </p>
        )}

        <Button type="submit" variant="primary" size="lg" disabled={loading} className="mt-1">
          {loading ? "Please wait…" : mode === "login" ? "Log in" : "Sign up"}
        </Button>

        <button
          type="button"
          className="text-subhead text-ink-subtle hover:text-ink transition-colors duration-fast"
          onClick={() => {
            setMode(mode === "login" ? "signup" : "login");
            setError("");
          }}
        >
          {mode === "login" ? "Need an account? Sign up" : "Already have an account? Log in"}
        </button>
      </motion.form>
    </div>
  );
}
