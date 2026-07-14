import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { de } from "@/lib/i18n/de";

export type EnrollmentRow = {
  id: string;
  status: "pending" | "sent" | "held" | "skipped" | "failed" | "canceled";
  enrolledAt: string;
  scheduledSendAt: string;
  sendJobId: string | null;
  contactName: string;
};

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("de-DE", { dateStyle: "short", timeStyle: "short" }).format(
    new Date(value),
  );
}

const STATUS_LABEL: Record<EnrollmentRow["status"], string> = {
  pending: de.flows.statusPending,
  sent: de.flows.statusSent,
  held: de.flows.statusHeld,
  skipped: de.flows.statusSkipped,
  failed: de.flows.statusFailed,
  canceled: de.flows.statusCanceled,
};

function statusBadge(status: EnrollmentRow["status"]) {
  const cls =
    status === "sent"
      ? "border-success text-success"
      : status === "pending"
        ? "border-primary text-primary"
        : status === "held"
          ? "border-warning text-warning"
          : status === "failed"
            ? "border-destructive text-destructive"
            : "text-muted-foreground";
  return (
    <Badge variant="outline" className={cls}>
      {STATUS_LABEL[status]}
    </Badge>
  );
}

export function FlowEnrollments({ rows }: { rows: EnrollmentRow[] }) {
  return (
    <div className="space-y-2">
      <h2 className="text-base font-semibold">{de.flows.enrollmentsTitle}</h2>
      {rows.length === 0 ? (
        <p className="text-muted-foreground rounded-md border border-dashed p-6 text-center text-sm">
          {de.flows.enrollmentsEmpty}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{de.flows.colContact}</TableHead>
                <TableHead>{de.flows.colEnrolledAt}</TableHead>
                <TableHead>{de.flows.colScheduledFor}</TableHead>
                <TableHead>{de.flows.colStatus}</TableHead>
                <TableHead>{de.flows.colJob}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="max-w-48 truncate">{row.contactName}</TableCell>
                  <TableCell className="whitespace-nowrap">{formatDateTime(row.enrolledAt)}</TableCell>
                  <TableCell className="whitespace-nowrap">
                    {formatDateTime(row.scheduledSendAt)}
                  </TableCell>
                  <TableCell>{statusBadge(row.status)}</TableCell>
                  <TableCell>
                    {row.sendJobId ? (
                      <Link
                        href={`/app/sendungen/${row.sendJobId}`}
                        className="text-sm underline underline-offset-4"
                      >
                        {de.flows.viewJob}
                      </Link>
                    ) : (
                      "–"
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
