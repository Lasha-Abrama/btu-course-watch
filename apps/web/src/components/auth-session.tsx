"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import type {
  CurrentUserResponse,
  LoginRequest,
} from "@btu-course-watch/contracts";
import { getCurrentUser, login, logout } from "../lib/auth-api";

interface AuthContextValue {
  user: CurrentUserResponse | null;
  loading: boolean;
  error: string | null;
  signIn: (input: LoginRequest) => Promise<void>;
  signOut: () => Promise<void>;
  recheck: () => Promise<CurrentUserResponse | null>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthSessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<CurrentUserResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);

  const recheck = useCallback(async (): Promise<CurrentUserResponse | null> => {
    const current = ++generation.current;
    setLoading(true);
    setError(null);
    try {
      const profile = await getCurrentUser();
      if (current === generation.current) setUser(profile);
      return profile;
    } catch {
      if (current === generation.current) {
        setUser(null);
        setError("We could not check your session. Please try again.");
      }
      return null;
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void recheck();
  }, [recheck]);

  async function signIn(input: LoginRequest): Promise<void> {
    await login(input);
    if (!(await recheck()))
      throw new Error(
        "Sign-in succeeded, but your session could not be confirmed.",
      );
  }

  async function signOut(): Promise<void> {
    await logout();
    generation.current += 1;
    setUser(null);
    setLoading(false);
    setError(null);
  }

  return (
    <AuthContext.Provider
      value={{ user, loading, error, signIn, signOut, recheck }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuthSession(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("AuthSessionProvider is missing");
  return context;
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading, error, recheck } = useAuthSession();
  const router = useRouter();
  useEffect(() => {
    if (!loading && !user && !error) router.replace("/login");
  }, [loading, user, error, router]);
  if (loading) return <p role="status">Checking your session…</p>;
  if (error)
    return (
      <div role="alert">
        {error}{" "}
        <button type="button" onClick={() => void recheck()}>
          Try again
        </button>
      </div>
    );
  return user ? <>{children}</> : null;
}
