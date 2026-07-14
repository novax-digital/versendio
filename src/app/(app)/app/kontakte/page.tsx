import type { Metadata } from "next";
import { Upload, Users } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/server/auth-context";
import { Card, CardContent } from "@/components/ui/card";
import { sanitizeSearchTerm } from "@/lib/shared/search-term";
import { de } from "@/lib/i18n/de";
import { ContactList, type Contact } from "./contact-list";
import { CreateContactButton } from "./create-contact-button";
import { SearchInput } from "./search-input";
import { ButtonLink } from "@/components/ui-ext/button-link";

export const metadata: Metadata = { title: de.contacts.title };

const PAGE_SIZE = 50;

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; seite?: string }>;
}) {
  await requireProfile();
  const { q, seite } = await searchParams;
  const page = Math.max(1, Number(seite) || 1);
  const supabase = await createClient();

  let query = supabase
    .from("contacts")
    .select(
      "id, salutation, first_name, last_name, company, street, address_extra, zip, city, country, email",
      { count: "exact" },
    )
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

  const term = q ? sanitizeSearchTerm(q) : "";
  if (term) {
    query = query.or(
      `first_name.ilike.%${term}%,last_name.ilike.%${term}%,company.ilike.%${term}%,city.ilike.%${term}%`,
    );
  }

  const { data: contacts, count } = await query;
  const totalPages = Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE));

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{de.contacts.title}</h1>
          <p className="text-muted-foreground text-sm">{de.contacts.subtitle}</p>
        </div>
        <div className="flex gap-2">
          <ButtonLink href="/app/kontakte/import" variant="outline">
            <Upload className="size-4" aria-hidden />
            {de.contacts.importButton}
          </ButtonLink>
          <CreateContactButton />
        </div>
      </div>

      <SearchInput initialValue={q ?? ""} />

      {(count ?? 0) === 0 && !q ? (
        <Card>
          <CardContent className="text-muted-foreground flex flex-col items-center gap-3 py-12 text-center text-sm">
            <Users className="size-8" aria-hidden />
            <p className="text-foreground font-medium">{de.contacts.empty}</p>
            <p>{de.contacts.emptyCta}</p>
            <CreateContactButton />
          </CardContent>
        </Card>
      ) : (
        <ContactList
          contacts={(contacts ?? []) as Contact[]}
          page={page}
          totalPages={totalPages}
          searchTerm={q ?? ""}
        />
      )}
    </div>
  );
}
