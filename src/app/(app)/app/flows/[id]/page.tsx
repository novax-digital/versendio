import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/server/auth-context";
import { minutesToDelay } from "@/lib/shared/flows";
import { de } from "@/lib/i18n/de";
import { FlowBuilder, type FlowInitial } from "../flow-builder";
import { loadFlowBuilderOptions } from "../load-options";
import { FlowEnrollments, type EnrollmentRow } from "./flow-enrollments";
import { DeleteFlowButton } from "./delete-flow-button";

export const metadata: Metadata = { title: de.flows.title };

function contactName(c: { first_name: string | null; last_name: string | null; company: string | null } | null) {
  if (!c) return "–";
  const person = [c.first_name, c.last_name].filter(Boolean).join(" ");
  return person || c.company || "–";
}

export default async function FlowDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await requireProfile();
  const { id } = await params;
  const supabase = await createClient();

  const { data: flow } = await supabase
    .from("flows")
    .select(
      "id, name, list_id, letter_id, delay_minutes, is_color, is_duplex, registered, sender_address_id, lead_lists(name)",
    )
    .eq("id", id)
    .maybeSingle();
  if (!flow) notFound();

  const [{ letters, lists, senders, availableRegistered }, { data: enrollmentData }] =
    await Promise.all([
      loadFlowBuilderOptions(),
      supabase
        .from("flow_enrollments")
        .select("id, status, enrolled_at, scheduled_send_at, send_job_id, contacts(first_name, last_name, company)")
        .eq("flow_id", id)
        .order("scheduled_send_at", { ascending: true })
        .limit(200),
    ]);

  const delay = minutesToDelay(flow.delay_minutes);
  const initial: FlowInitial = {
    id: flow.id,
    name: flow.name,
    listId: flow.list_id,
    listName: (flow.lead_lists as unknown as { name: string } | null)?.name ?? "–",
    letterId: flow.letter_id,
    delayValue: delay.value,
    delayUnit: delay.unit,
    isColor: flow.is_color,
    isDuplex: flow.is_duplex,
    registered: flow.registered as FlowInitial["registered"],
    senderAddressId: flow.sender_address_id,
  };

  const rows: EnrollmentRow[] = (enrollmentData ?? []).map((e) => ({
    id: e.id,
    status: e.status as EnrollmentRow["status"],
    enrolledAt: e.enrolled_at,
    scheduledSendAt: e.scheduled_send_at,
    sendJobId: e.send_job_id,
    contactName: contactName(
      e.contacts as unknown as {
        first_name: string | null;
        last_name: string | null;
        company: string | null;
      } | null,
    ),
  }));

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href="/app/flows"
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
          >
            <ArrowLeft className="size-4" aria-hidden />
            {de.flows.title}
          </Link>
          <h1 className="mt-1 truncate text-xl font-semibold">{flow.name}</h1>
        </div>
        <DeleteFlowButton flowId={flow.id} />
      </div>

      <FlowBuilder
        initial={initial}
        letters={letters}
        lists={lists}
        senders={senders}
        availableRegistered={availableRegistered}
      />

      <FlowEnrollments rows={rows} />
    </div>
  );
}
