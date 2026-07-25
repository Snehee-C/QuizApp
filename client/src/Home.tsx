import { Link } from "react-router-dom";
import { useAuth } from "./auth";

export default function Home() {
  const { user } = useAuth();
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-6 px-4 text-center bg-white">
      <h1 className="text-5xl sm:text-6xl font-black text-gray-900 animate-slide-up">
        Menti<span className="text-brand">Clone</span>
      </h1>
      <p
        className="text-gray-500 max-w-md text-lg animate-slide-up"
        style={{ animationDelay: "80ms", animationFillMode: "backwards" }}
      >
        Create live polls and watch results light up in real time as your audience votes.
      </p>
      <div
        className="flex flex-col sm:flex-row gap-4 mt-2 animate-slide-up"
        style={{ animationDelay: "160ms", animationFillMode: "backwards" }}
      >
        <Link
          to={user ? "/dashboard" : "/login"}
          className="px-8 py-4 rounded-full bg-brand text-white font-bold text-lg hover:bg-brand-dark active:scale-95 transition shadow-lg shadow-brand/20"
        >
          {user ? "Go to dashboard" : "I'm presenting"}
        </Link>
        <Link
          to="/join"
          className="px-8 py-4 rounded-full border-2 border-gray-200 text-gray-700 font-bold text-lg hover:border-brand hover:text-brand active:scale-95 transition"
        >
          I have a code
        </Link>
      </div>
    </div>
  );
}
