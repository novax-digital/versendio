import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { requireProfile } from "@/lib/server/auth-context";
import { de } from "@/lib/i18n/de";
import { FlowBuilder } from "../flow-builder";
import { loadFlowBuilderOptions } from "../load-options";

export const metadata: Metadata = { title: de.flows.newFlow };

export default async function NewFlowPage() {
  await requireProfile();
  const { letters, lists, senders, availableRegistered } = await loadFlowBuilderOptions();

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link
          href="/app/flows"
          className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
        >
          <ArrowLeft className="size-4" aria-hidden />
          {de.flows.title}
        </Link>
        <h1 className="mt-1 text-xl font-semibold">{de.flows.newFlow}</h1>
      </div>
      <FlowBuilder
        initial={null}
        letters={letters}
        lists={lists}
        senders={senders}
        availableRegistered={availableRegistered}
      />
    </div>
  );
}
