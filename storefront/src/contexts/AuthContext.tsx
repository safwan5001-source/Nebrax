"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ACCOUNT_HINT_COOKIE } from "@/lib/account/session-cookies";
import {
  getAccountsAvailable,
  login as loginAction,
  logout as logoutAction,
  register as registerAction,
  syncSession,
} from "@/lib/data/customer";

export interface User {
  id: string;
  email: string;
  first_name?: string | null;
  last_name?: string | null;
  phone?: string | null;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  /**
   * B2C-ACCOUNTS — whether this host offers customer accounts, as the API states it. `null` until the first session
   * sync answers; `false` keeps every account screen on the honest "not available" notice and no session is read.
   */
  accountsAvailable: boolean | null;
  login: (
    email: string,
    password: string,
    remember?: boolean,
  ) => Promise<{ success: boolean; code?: string }>;
  register: (params: {
    email: string;
    password: string;
    password_confirmation: string;
    first_name?: string;
    last_name?: string;
    phone?: string;
    basePath?: string;
  }) => Promise<{
    success: boolean;
    verificationRequired?: boolean;
    code?: string;
  }>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  /** Asks the API once whether this host has customer accounts (used by the account screens for a visitor with no session). */
  checkAccountsAvailable: () => Promise<void>;
  isAuthenticated: boolean;
}

/** The presence hint (see `ACCOUNT_HINT_COOKIE`): is there any chance of an account session in this browser? */
function hasAccountHint(): boolean {
  if (typeof document === "undefined") return false;
  return document.cookie
    .split("; ")
    .some((cookie) => cookie.startsWith(`${ACCOUNT_HINT_COOKIE}=`));
}

export const AuthContext = createContext<AuthContextType | undefined>(
  undefined,
);

function toUser(customer: User): User {
  return {
    id: customer.id,
    email: customer.email,
    first_name: customer.first_name,
    last_name: customer.last_name,
    phone: customer.phone,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [accountsAvailable, setAccountsAvailable] = useState<boolean | null>(
    null,
  );
  const router = useRouter();

  // Fetch current user from server, refreshing an expired JWT when possible.
  // A transparent refresh persists a new token via a Server Action (cookie
  // writes aren't allowed during a Server Component render), so re-render the
  // server components afterwards to replace any data they fetched with the
  // stale session.
  const refreshUser = useCallback(async () => {
    // B2C-ACCOUNTS: the server decides whether this host has accounts at all; when it does not, `syncSession` reads no
    // session and the provider stays anonymous.
    try {
      const { available, customer, refreshed, stale } = await syncSession();
      setAccountsAvailable(available);
      // A transparent token rotation may have happened even when the follow-up
      // fetch came back stale — re-render server components so they pick up the
      // renewed session either way.
      if (refreshed) {
        router.refresh();
      }
      // A transient fetch failure returns `stale` — keep the current session
      // rather than flashing the user to logged-out on a blip.
      if (stale) return;
      setUser(customer ? toUser(customer) : null);
    } catch {
      // Unexpected failure — leave the existing session untouched.
    }
  }, [router]);

  // Timestamp of the last session sync, used to throttle focus-driven re-syncs.
  const lastSyncRef = useRef(0);

  // Initialize auth state
  useEffect(() => {
    const initAuth = async () => {
      lastSyncRef.current = Date.now();
      // No hint ⇒ no account session can exist in this browser: make no request (guests and stores without accounts
      // behave exactly as before this feature).
      if (hasAccountHint()) await refreshUser();
      setLoading(false);
    };
    initAuth();
  }, [refreshUser]);

  // Re-sync the session when the tab regains focus after being idle. The JWT
  // can expire while the tab is backgrounded; refreshing on return renews it
  // (or treats the session as logged out) without a manual reload. Throttled
  // so ordinary focus churn doesn't hit the server on every event.
  useEffect(() => {
    const RESYNC_THROTTLE_MS = 30_000;
    const maybeResync = () => {
      if (document.visibilityState !== "visible") return;
      if (!hasAccountHint()) {
        // The session (and its hint) is gone — signed out in another tab, or an expired persistent cookie. Drop any
        // authenticated state this tab still holds, with no request (anonymous visitors still cost nothing).
        setUser((current) => (current === null ? current : null));
        return;
      }
      if (Date.now() - lastSyncRef.current < RESYNC_THROTTLE_MS) return;
      lastSyncRef.current = Date.now();
      void refreshUser();
    };
    document.addEventListener("visibilitychange", maybeResync);
    window.addEventListener("focus", maybeResync);
    return () => {
      document.removeEventListener("visibilitychange", maybeResync);
      window.removeEventListener("focus", maybeResync);
    };
  }, [refreshUser]);

  // Login
  const login = useCallback(
    async (email: string, password: string, remember = true) => {
      const result = await loginAction(email, password, remember);
      if (result.success && result.user) {
        setUser(toUser(result.user));
        setAccountsAvailable(true);
        router.refresh();
      }
      return result;
    },
    [router],
  );

  const checkAccountsAvailable = useCallback(async () => {
    try {
      setAccountsAvailable(await getAccountsAvailable());
    } catch {
      setAccountsAvailable(false);
    }
  }, []);

  // Register: the account is created UNVERIFIED — there is no session until the e-mail link is followed, so nothing is
  // signed in here.
  const register = useCallback(
    async (params: {
      email: string;
      password: string;
      password_confirmation: string;
      first_name?: string;
      last_name?: string;
      phone?: string;
      basePath?: string;
    }) => registerAction(params),
    [],
  );

  // Logout
  const logout = useCallback(async () => {
    await logoutAction();
    setUser(null);
    router.refresh();
  }, [router]);

  const value = useMemo<AuthContextType>(
    () => ({
      user,
      loading,
      accountsAvailable,
      login,
      register,
      logout,
      refreshUser,
      checkAccountsAvailable,
      isAuthenticated: !!user,
    }),
    [
      user,
      loading,
      accountsAvailable,
      login,
      register,
      logout,
      refreshUser,
      checkAccountsAvailable,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
