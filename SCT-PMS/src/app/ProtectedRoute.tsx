import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useSession } from "@/lib/session";
import { hasPermission, type Action, type Module } from "@/lib/permissions";

interface Props {
  requireKind?: "platform" | "company";
  /** Blocks direct URL access unless the current company user has this module/action permission. */
  requiredPermission?: { module: Module; action: Action };
}

export function ProtectedRoute({ requireKind, requiredPermission }: Props) {
  const { session, loading } = useSession();
  const location = useLocation();

  if (loading) return null;

  if (!session) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (session.user.kind === "company" && session.user.accountStatus !== "active") {
    return <Navigate to="/account-suspended" replace />;
  }

  if (requireKind && session.user.kind !== requireKind) {
    return <Navigate to="/access-denied" replace />;
  }

  if (requiredPermission) {
    const allowed = session.user.kind === "company" && hasPermission(session.user.roles, requiredPermission.module, requiredPermission.action);
    if (!allowed) {
      return <Navigate to="/access-denied" replace />;
    }
  }

  return <Outlet />;
}
