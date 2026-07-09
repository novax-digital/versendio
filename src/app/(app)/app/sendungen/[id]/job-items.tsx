"use client";

import { useState, useTransition } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { loadItemTimelineAction, type TimelineEvent } from "./timeline-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCents } from "@/lib/shared/money";
import { de } from "@/lib/i18n/de";

type Item = {
  id: string;
  status: string;
  recipient_snapshot: {
    firstName?: string | null;
    lastName?: string | null;
    company?: string | null;
    city?: string | null;
  };
  vk_cents: number;
  sheet_count: number | null;
  error_message: string | null;
  refunded_at: string | null;
  frankier_id: string | null;
};

const badgeVariant: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  sent: "outline",
  failed: "destructive",
  canceled: "secondary",
  on_hold_funds: "destructive",
};

export function JobItems({ items }: { items: Item[] }) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8" />
            <TableHead>{de.sendJobs.recipient}</TableHead>
            <TableHead>{de.sendJobs.statusLabel}</TableHead>
            <TableHead className="text-right">{de.send.perLetter}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <ItemRow key={item.id} item={item} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function ItemRow({ item }: { item: Item }) {
  const [open, setOpen] = useState(false);
  const [events, setEvents] = useState<TimelineEvent[] | null>(null);
  const [pending, startTransition] = useTransition();

  const recipient = item.recipient_snapshot;
  const name =
    [recipient.firstName, recipient.lastName].filter(Boolean).join(" ") ||
    recipient.company ||
    "–";

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && events === null) {
      startTransition(async () => {
        setEvents(await loadItemTimelineAction(item.id));
      });
    }
  };

  return (
    <>
      <TableRow className="cursor-pointer" onClick={toggle}>
        <TableCell>
          <Button variant="ghost" size="icon-xs" aria-label={de.sendJobs.timeline} aria-expanded={open}>
            {open ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
          </Button>
        </TableCell>
        <TableCell className="font-medium">
          {name}
          {recipient.company && (recipient.firstName || recipient.lastName)
            ? ` · ${recipient.company}`
            : ""}
          <span className="text-muted-foreground block text-xs">{recipient.city ?? ""}</span>
        </TableCell>
        <TableCell>
          <Badge variant={badgeVariant[item.status] ?? "default"}>
            {de.sendJobs.itemStatus[item.status] ?? item.status}
          </Badge>
          {item.refunded_at ? (
            <Badge variant="secondary" className="ml-1">
              {de.sendJobs.refunded}
            </Badge>
          ) : null}
          {item.error_message ? (
            <span className="text-destructive block max-w-64 truncate text-xs" title={item.error_message}>
              {item.error_message}
            </span>
          ) : null}
        </TableCell>
        <TableCell className="text-right">{formatCents(item.vk_cents)}</TableCell>
      </TableRow>
      {open ? (
        <TableRow>
          <TableCell />
          <TableCell colSpan={3}>
            {pending || events === null ? (
              <p className="text-muted-foreground py-2 text-xs">{de.common.loading}</p>
            ) : events.length === 0 ? (
              <p className="text-muted-foreground py-2 text-xs">–</p>
            ) : (
              <ol className="space-y-1 py-2">
                {events.map((event) => (
                  <li key={event.id} className="flex items-baseline gap-2 text-xs">
                    <span className="text-muted-foreground shrink-0 tabular-nums">
                      {new Intl.DateTimeFormat("de-DE", {
                        dateStyle: "short",
                        timeStyle: "short",
                      }).format(new Date(event.occurred_at))}
                    </span>
                    <span>
                      {event.status ? (de.sendJobs.itemStatus[event.status] ?? event.status) : ""}
                      {event.details ? ` — ${event.details}` : ""}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}
