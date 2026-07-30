import { Construction } from "lucide-react";
import { Card, EmptyState } from "@/components/common";

export function PlaceholderPage({ title }: { title: string }) {
  return (
    <div className="p-4 lg:p-6">
      <Card>
        <EmptyState
          className="py-24"
          icon={<Construction size={24} />}
          title={`${title} is coming soon`}
          description="This module is scoped for a later delivery milestone. The layout, navigation and data contracts are already in place."
        />
      </Card>
    </div>
  );
}
