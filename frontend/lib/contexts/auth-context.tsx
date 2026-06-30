'use client';

/**
 * Authentication Context
 *
 * Provides authentication state and methods throughout the app.
 *
 * Performance note: the entire dashboard shell — sidebar, route guards and
 * per-module gating — blocks on the current user (its `module_permissions`).
 * To avoid a blank "Loading…" → pop-in on every full page load, the last known
 * user is cached in localStorage and hydrated SYNCHRONOUSLY on mount, so the
 * correct modules render immediately. We then revalidate `/api/users/me/` in the
 * background and reconcile. The backend remains the source of truth and enforces
 * every API, so rendering last-known access state is safe — a tightened
 * permission simply corrects on the next revalidation, and any blocked data
 * fetch still 403s server-side.
 *
 * Usage:
 *   const { user, isAuthenticated, login, logout } = useAuth();
 */

import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { authService, type LoginCredentials } from '@/lib/api';
import type { User } from '@/lib/types';

const CACHED_USER_KEY = 'cached_user';

/**
 * Hard cap on the on-mount profile revalidation fetch. getCurrentUser() itself
 * has no timeout, so without this a momentarily-unresponsive backend (e.g. right
 * after a deploy) could hang the fetch indefinitely and, on a cold start with no
 * cached user, strand the shell on "Loading your access…" forever. After this we
 * give up and fall into the catch path (actionable access-load-failed screen).
 */
const AUTH_REVALIDATE_TIMEOUT_MS = 12_000;

/** Read the cached current user, but only if a still-valid token backs it. */
function readCachedUser(): User | null {
  if (typeof window === 'undefined') return null;
  if (!authService.isAuthenticated()) return null;
  try {
    const raw = localStorage.getItem(CACHED_USER_KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
}

function writeCachedUser(user: User | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (user) {
      localStorage.setItem(CACHED_USER_KEY, JSON.stringify(user));
    } else {
      localStorage.removeItem(CACHED_USER_KEY);
    }
  } catch {
    /* cache is best-effort */
  }
}

/** Dev-only timing for the permission/profile fetch (never logs payload). */
function logFetchTiming(startedAt: number): void {
  if (process.env.NODE_ENV === 'production') return;
  const ms = Math.round(performance.now() - startedAt);
  // eslint-disable-next-line no-console
  console.debug(`[auth] /users/me resolved in ${ms}ms`);
}

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  /** True once we know the user's access state (from cache or a fresh fetch). */
  hasResolvedAccess: boolean;
  /** True when there is no cached user AND the profile fetch failed. */
  accessLoadFailed: boolean;
  error: string | null;
  login: (credentials: LoginCredentials) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  // The cached user lives in localStorage, which only exists on the client.
  // Reading it in the initial state would make the client's first render
  // diverge from the server-rendered HTML (always logged-out) and throw a
  // hydration mismatch (React #418), forcing a full client re-render. So we
  // start from the server-consistent state and adopt the cache in the mount
  // effect below — it runs immediately after hydration, so the correct modules
  // still render on first paint without waiting on the revalidation fetch.
  const [user, setUser] = useState<User | null>(null);
  const hadCachedUser = useRef(false);
  const [isLoading, setIsLoading] = useState(true);
  const [hasResolvedAccess, setHasResolvedAccess] = useState(false);
  const [accessLoadFailed, setAccessLoadFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Adopt the cached user (client-only) on mount, then revalidate against the
  // backend (and populate it on a cold start).
  useEffect(() => {
    let cancelled = false;

    // Synchronously adopt the last-known user from cache so the correct modules
    // render on the first client paint, before the revalidation round-trip.
    const cachedUser = readCachedUser();
    hadCachedUser.current = cachedUser !== null;
    if (cachedUser) {
      setUser(cachedUser);
      setIsLoading(false);
      setHasResolvedAccess(true);
    }

    const checkAuth = async () => {
      if (!authService.isAuthenticated()) {
        // Token missing/expired: drop any stale cache and finish loading.
        writeCachedUser(null);
        if (!cancelled) {
          setUser(null);
          setHasResolvedAccess(true);
          setIsLoading(false);
        }
        return;
      }
      const startedAt = typeof performance !== 'undefined' ? performance.now() : 0;
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      try {
        // Race the revalidation against a timeout so a hung backend can't leave
        // isLoading stuck forever (see AUTH_REVALIDATE_TIMEOUT_MS). A timeout
        // rejects into the catch below, which — with a still-valid token and no
        // cached fallback — shows the retryable access-load-failed screen.
        const currentUser = await Promise.race([
          authService.getCurrentUser(),
          new Promise<never>((_, reject) => {
            timeoutId = setTimeout(
              () => reject(new Error('Profile load timed out')),
              AUTH_REVALIDATE_TIMEOUT_MS,
            );
          }),
        ]);
        clearTimeout(timeoutId);
        logFetchTiming(startedAt);
        if (cancelled) return;
        writeCachedUser(currentUser);
        setUser(currentUser);
        setAccessLoadFailed(false);
        setHasResolvedAccess(true);
      } catch {
        clearTimeout(timeoutId);
        if (cancelled) return;
        // A failed revalidation should not blow away a usable cached session —
        // keep the cached user (backend still enforces every API). Only react
        // when we had nothing cached to fall back on.
        if (!hadCachedUser.current) {
          if (!authService.isAuthenticated()) {
            // The token was invalidated (e.g. the api client's refresh failed
            // and cleared it): treat this as logged out and let the layout's
            // redirect effect send the user to /login.
            writeCachedUser(null);
            setUser(null);
            setHasResolvedAccess(true);
          } else {
            // Token is still valid → this was a transient/network failure
            // loading the profile. Surface an actionable message instead of a
            // blank shell, and keep the session so a refresh can recover.
            setAccessLoadFailed(true);
            setHasResolvedAccess(true);
          }
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    checkAuth();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (credentials: LoginCredentials) => {
    setIsLoading(true);
    setError(null);

    try {
      const { user: loggedInUser } = await authService.login(credentials);
      if (loggedInUser) {
        writeCachedUser(loggedInUser);
        setUser(loggedInUser);
        setHasResolvedAccess(true);
        setAccessLoadFailed(false);
      }
      router.push('/dashboard');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Login failed';
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }, [router]);

  const logout = useCallback(async () => {
    setIsLoading(true);
    try {
      await authService.logout();
    } finally {
      writeCachedUser(null);
      setUser(null);
      setHasResolvedAccess(false);
      setIsLoading(false);
      router.push('/login');
    }
  }, [router]);

  const refreshUser = useCallback(async () => {
    if (authService.isAuthenticated()) {
      try {
        const currentUser = await authService.getCurrentUser();
        writeCachedUser(currentUser);
        setUser(currentUser);
        setAccessLoadFailed(false);
        setHasResolvedAccess(true);
      } catch {
        // Keep the cached user on a transient refresh failure.
      }
    }
  }, []);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        isLoading,
        hasResolvedAccess,
        accessLoadFailed,
        error,
        login,
        logout,
        refreshUser,
        clearError,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
