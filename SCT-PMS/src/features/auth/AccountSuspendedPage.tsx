import { Ban } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button, Card, EmptyState } from "@/components/common";
import { useSession } from "@/lib/session";

export function AccountSuspendedPage() {
  const navigate = useNavigate();
  const { logout } = useSession();

  return (
    <div className="flex h-full items-center justify-center bg-white p-6">
      <Card className="max-w-md">
        <EmptyState
          className="py-16"
          icon={<Ban size={24} />}
          title="Account not active"
          description="Your account has been suspended or deactivated. Contact your company administrator for access."
        />
        <div className="flex justify-center pb-8">
          <Button
            onClick={async () => {
              await logout();
              navigate("/login", { replace: true });
            }}
          >
            Back to login
          </Button>
        </div>
      </Card>
    </div>
  );
}
