import { useState } from "react";
import { useNavigate } from "react-router-dom";

export default function Join() {
  const [code, setCode] = useState("");
  const navigate = useNavigate();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const clean = code.trim();
    if (clean) navigate(`/join/${clean}`);
  }

  return (
    <div className="h-[100dvh] flex items-center justify-center px-4 bg-white">
      <form onSubmit={submit} className="w-full max-w-xs flex flex-col gap-5 text-center animate-slide-up">
        <h1 className="text-3xl font-black text-gray-900 mb-2">
          Enter join <span className="text-brand">code</span>
        </h1>
        <input
          className="border-2 border-gray-200 bg-white text-gray-900 placeholder-gray-300 rounded-2xl px-4 py-4 text-center text-3xl font-black tracking-widest focus:border-brand focus:outline-none transition"
          placeholder="123456"
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          inputMode="numeric"
          maxLength={6}
          autoFocus
        />
        <button
          type="submit"
          disabled={!code.trim()}
          className="bg-brand text-white rounded-full py-4 font-bold text-lg hover:bg-brand-dark active:scale-95 transition disabled:opacity-40 shadow-lg shadow-brand/20"
        >
          Join
        </button>
      </form>
    </div>
  );
}
