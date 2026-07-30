import { ShieldAlert } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button, Card, EmptyState } from "@/components/common";
import { useSession } from "@/lib/session";

export function AccessDeniedPage() {
  const navigate = useNavigate();
  const { logout } = useSession();

  return (
    <div className="flex h-full items-center justify-center bg-white p-6">
      <Card className="max-w-md">
        <EmptyState
          className="py-16"
          icon={<ShieldAlert size={24} />}
          title="Access denied"
          description="Your account doesn't have permission to view this area."
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
