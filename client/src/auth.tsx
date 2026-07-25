import { createContext, useContext, useState, type ReactNode } from "react";
import { api, clearAuth, getUser, setAuth, type User } from "./lib/api";

interface AuthCtx {
  user: User | null;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string, name: string) => Promise<void>;
  logout: () => void;
}

const Ctx = createContext<AuthCtx>(null!);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(getUser());

  async function login(email: string, password: string) {
    const { token, user } = await api.login(email, password);
    setAuth(token, user);
    setUser(user);
  }
  async function signup(email: string, password: string, name: string) {
    const { token, user } = await api.signup(email, password, name);
    setAuth(token, user);
    setUser(user);
  }
  function logout() {
    clearAuth();
    setUser(null);
  }

  return <Ctx.Provider value={{ user, login, signup, logout }}>{children}</Ctx.Provider>;
}

export function useAuth() {
  return useContext(Ctx);
}
