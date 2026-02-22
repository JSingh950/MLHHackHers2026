"use client";

import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { ApiError, api, type PublicUser, type SessionResult } from "../lib/api";

const STORAGE_KEY = "goalcoach.session.v1";

export interface StoredSession {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: number;
  user: PublicUser;
}

type AuthContextValue = {
  session: StoredSession | null;
  hydrated: boolean;
  isAuthenticated: boolean;
  login: (payload: { email: string; password: string }) => Promise<void>;
  register: (payload: {
    email: string;
    password: string;
    name: string;
    timezone: string;
    phone_e164?: string | null;
    consent_flags: PublicUser["consent_flags"];
  }) => Promise<void>;
  logout: () => Promise<void>;
  verifyPhone: (payload: { phone_e164: string; otp_code?: string }) => Promise<void>;
  refreshAccessToken: () => Promise<string>;
  runAuthed: <T>(fn: (accessToken: string) => Promise<T>) => Promise<T>;
  setSession: (session: StoredSession | null) => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

function toStoredSession(session: SessionResult): StoredSession {
  return {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    accessTokenExpiresAt: Date.now() + session.expires_in * 1000 - 5_000,
    user: session.user
  };
}

function readStoredSession(): StoredSession | null {
  if (typeof window === "undefined") {
    return null;
  }
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as StoredSession;
  } catch {
    window.localStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

function writeStoredSession(session: StoredSession | null) {
  if (typeof window === "undefined") {
    return;
  }
  if (!session) {
    window.localStorage.removeItem(STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSessionState] = useState<StoredSession | null>(null);
  const [hydrated, setHydrated] = useState(false);

  const setSession = useCallback((next: StoredSession | null) => {
    setSessionState(next);
    writeStoredSession(next);
  }, []);

  useEffect(() => {
    setSessionState(readStoredSession());
    setHydrated(true);
  }, []);

  const login = useCallback(async (payload: { email: string; password: string }) => {
    const next = await api.login(payload);
    setSession(toStoredSession(next));
  }, [setSession]);

  const register = useCallback<AuthContextValue["register"]>(async (payload) => {
    const next = await api.register(payload);
    setSession(toStoredSession(next));
  }, [setSession]);

  const logout = useCallback(async () => {
    const current = session;
    setSession(null);
    if (!current) {
      return;
    }
    try {
      await api.logout({ refresh_token: current.refreshToken }, current.accessToken);
    } catch {
      // local logout still succeeds
    }
  }, [session, setSession]);

  const refreshAccessToken = useCallback(async (): Promise<string> => {
    const current = readStoredSession() ?? session;
    if (!current) {
      throw new Error("Not authenticated");
    }

    const refreshed = await api.refresh({ refresh_token: current.refreshToken });
    const next: StoredSession = {
      ...current,
      accessToken: refreshed.access_token,
      accessTokenExpiresAt: Date.now() + refreshed.expires_in * 1000 - 5_000
    };
    setSession(next);
    return next.accessToken;
  }, [session, setSession]);

  const verifyPhone = useCallback(async (payload: { phone_e164: string; otp_code?: string }) => {
    const token = await (async () => {
      if (!session) {
        throw new Error("Not authenticated");
      }
      if (session.accessTokenExpiresAt > Date.now()) {
        return session.accessToken;
      }
      return refreshAccessToken();
    })();

    await api.verifyPhone(payload, token);

    if (session) {
      setSession({
        ...session,
        user: {
          ...session.user,
          phone_e164: payload.phone_e164,
          phone_verified: true
        }
      });
    }
  }, [refreshAccessToken, session, setSession]);

  const runAuthed = useCallback<AuthContextValue["runAuthed"]>(
    async <T,>(fn: (accessToken: string) => Promise<T>): Promise<T> => {
      if (!session) {
        throw new Error("Not authenticated");
      }

      const token = session.accessTokenExpiresAt > Date.now() ? session.accessToken : await refreshAccessToken();

      try {
        return await fn(token);
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          const refreshed = await refreshAccessToken();
          return fn(refreshed);
        }
        throw error;
      }
    },
    [refreshAccessToken, session]
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      hydrated,
      isAuthenticated: Boolean(session),
      login,
      register,
      logout,
      verifyPhone,
      refreshAccessToken,
      runAuthed,
      setSession
    }),
    [hydrated, login, logout, refreshAccessToken, register, runAuthed, session, setSession, verifyPhone]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}
