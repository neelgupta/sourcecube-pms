import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { ID } from "@/types";
import type { Company, PlatformUser, CompanyUser as CompanyUserDomain } from "@/types/tenant";
import { AUTH_FAILURE_EVENT, AUTH_FAILURE_STORAGE_KEY, api, ApiError } from "@/lib/api";
import { hasPermission, type Action, type Module } from "@/lib/permissions";
import { disconnectChatSocket } from "@/lib/chatSocket";

/** Shape returned by the API for the signed-in user (platform or company). */
export type SessionUser =
  | (Pick<PlatformUser, "id" | "name" | "email"> & { kind: "platform"; role: string })
  | (Pick<CompanyUserDomain, "id" | "name" | "email" | "tenantId" | "roles" | "accountStatus"> & { kind: "company" });

export interface Session {
  user: SessionUser;
  company?: Company;
}

interface SessionContextValue {
  session: Session | null;
  /** True while the initial /auth/me check is in flight (avoids flashing the login page). */
  loading: boolean;
  loginPlatform: (email: string, password: string) => Promise<void>;
  loginCompany: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    function clearInvalidSession() {
      setSession(null);
      setLoading(false);
      disconnectChatSocket();
    }

    function onStorage(event: StorageEvent) {
      if (event.key === AUTH_FAILURE_STORAGE_KEY) clearInvalidSession();
    }

    window.addEventListener(AUTH_FAILURE_EVENT, clearInvalidSession);
    window.addEventListener("storage", onStorage);

    api
      .me()
      .then((res) => setSession(res as Session))
      .catch(() => clearInvalidSession())
      .finally(() => setLoading(false));

    return () => {
      window.removeEventListener(AUTH_FAILURE_EVENT, clearInvalidSession);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const value = useMemo<SessionContextValue>(
    () => ({
      session,
      loading,
      loginPlatform: async (email, password) => {
        const res = await api.loginPlatform(email, password);
        setSession(res as Session);
      },
      loginCompany: async (email, password) => {
        const res = await api.loginCompany(email, password);
        setSession(res as Session);
      },
      logout: async () => {
        await api.logout().catch(() => undefined);
        disconnectChatSocket();
        setSession(null);
      },
    }),
    [session, loading],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession must be used within a SessionProvider");
  return ctx;
}

/** Checks the current company user's permissions. Platform users and logged-out sessions always fail. */
export function usePermission(module: Module, action: Action): boolean {
  const { session } = useSession();
  if (!session || session.user.kind !== "company") return false;
  return hasPermission(session.user.roles, module, action);
}

export function useCurrentTenantId(): ID | undefined {
  const { session } = useSession();
  if (!session) return undefined;
  return session.user.kind === "company" ? session.user.tenantId : undefined;
}

/** The signed-in company's configured timezone, for formatting dates/times consistently with
 *  how the server buckets them (e.g. the resource planner) — see @/lib/formatDate. Undefined for
 *  platform users/logged-out sessions, which have no company timezone; callers should fall back
 *  to the browser's local timezone in that case (the formatters in formatDate.ts already do). */
export function useCompanyTimezone(): string | undefined {
  const { session } = useSession();
  return session?.company?.timezone;
}

/** Tenant isolation guard: filters tenant-owned records down to the given tenant. */
export function scopeToCurrentTenant<T extends { tenantId: ID }>(records: T[], tenantId: ID | undefined): T[] {
  if (!tenantId) return [];
  return records.filter((r) => r.tenantId === tenantId);
}

export { ApiError };
