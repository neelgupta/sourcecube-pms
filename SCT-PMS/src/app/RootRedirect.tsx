import { Navigate } from "react-router-dom";
import { useSession } from "@/lib/session";

/** Sends `/` and unmatched paths to the right home based on who's signed in. */
export function RootRedirect() {
  const { session, loading } = useSession();

  if (loading) return null;
  if (!session) return <Navigate to="/login" replace />;
  if (session.user.kind === "platform") return <Navigate to="/saas" replace />;
  return <Navigate to="/dashboard" replace />;
}
