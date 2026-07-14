"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { toggleFlowActiveAction } from "./actions";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { formatDelay } from "@/lib/shared/flows";
import { de } from "@/lib/i18n/de";

export type FlowRow = {
  id: string;
  name: string;
  isActive: boolean;
  delayMinutes: number;
  listName: string;
  letterTitle: string;
  enrollments: number;
};

export function FlowList({ flows }: { flows: FlowRow[] }) {
  return (
    <ul className="space-y-3">
      {flows.map((flow) => (
        <li key={flow.id}>
          <FlowCard flow={flow} />
        </li>
      ))}
    </ul>
  );
}

function FlowCard({ flow }: { flow: FlowRow }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const toggle = (next: boolean) => {
    const fd = new FormData();
    fd.set("id", flow.id);
    fd.set("active", next ? "true" : "false");
    startTransition(async () => {
      const result = await toggleFlowActiveAction(null, fd);
      if (result.ok) {
        toast.success(next ? de.flows.activated : de.flows.deactivated);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <Card className="hover:border-primary/60 transition-colors">
      <CardContent className="flex flex-wrap items-center gap-4 py-4">
        <Link href={`/app/flows/${flow.id}`} className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium">{flow.name}</span>
            <Badge
              variant="outline"
              className={flow.isActive ? "border-success text-success" : "text-muted-foreground"}
            >
              {flow.isActive ? de.flows.active : de.flows.inactive}
            </Badge>
          </div>
          <p className="text-muted-foreground mt-0.5 truncate text-sm">
            {flow.listName} · {flow.letterTitle} · {formatDelay(flow.delayMinutes)}
          </p>
          <p className="text-muted-foreground text-xs">
            {de.flows.colEnrollments}: {flow.enrollments}
          </p>
        </Link>
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-xs">
            {flow.isActive ? de.flows.active : de.flows.inactive}
          </span>
          <Switch
            checked={flow.isActive}
            onCheckedChange={toggle}
            disabled={pending}
            aria-label={flow.isActive ? de.flows.deactivate : de.flows.activate}
          />
        </div>
      </CardContent>
    </Card>
  );
}
