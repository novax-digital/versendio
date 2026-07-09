"use client";

import { useActionState, useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Trash2, UserPlus } from "lucide-react";
import { addListEntryAction, removeListEntryAction, deleteLeadListAction } from "../actions";
import { searchContactsAction } from "./search-contacts-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useRouter } from "next/navigation";
import { de } from "@/lib/i18n/de";

export type ListEntry = {
  id: string;
  contact_id: string;
  contacts: {
    id: string;
    salutation: string | null;
    first_name: string | null;
    last_name: string | null;
    company: string | null;
    street: string;
    zip: string;
    city: string;
    country: string;
  } | null;
};

type ContactHit = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  city: string;
};

export function ListDetail({ listId, entries }: { listId: string; entries: ListEntry[] }) {
  const router = useRouter();
  const [deleteState, deleteAction, deletePending] = useActionState(deleteLeadListAction, null);

  useEffect(() => {
    if (deleteState?.ok) {
      toast.success(de.leadLists.deleted);
      router.push("/app/leadlisten");
    } else if (deleteState && !deleteState.ok && deleteState.error) {
      toast.error(deleteState.error);
    }
  }, [deleteState, router]);

  return (
    <div className="space-y-6">
      <AddContactSearch listId={listId} />

      {entries.length === 0 ? (
        <p className="text-muted-foreground py-8 text-center text-sm">{de.leadLists.emptyList}</p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>{de.auth.company}</TableHead>
                <TableHead>{de.profile.city}</TableHead>
                <TableHead className="w-16 text-right">{de.common.actions}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => {
                const c = entry.contacts;
                if (!c) return null;
                return (
                  <TableRow key={entry.id}>
                    <TableCell className="font-medium">
                      {[c.first_name, c.last_name].filter(Boolean).join(" ") || "–"}
                    </TableCell>
                    <TableCell>{c.company ?? "–"}</TableCell>
                    <TableCell>
                      {c.zip} {c.city}
                      {c.country !== "DE" ? ` (${c.country})` : ""}
                    </TableCell>
                    <TableCell className="text-right">
                      <RemoveEntryButton entryId={entry.id} listId={listId} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <div className="flex justify-end">
        <AlertDialog>
          <AlertDialogTrigger render={<Button variant="outline" className="text-destructive" />}>
            <Trash2 className="size-4" aria-hidden />
            {de.common.delete}
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{de.common.delete}</AlertDialogTitle>
              <AlertDialogDescription>{de.leadLists.deleteConfirm}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{de.common.cancel}</AlertDialogCancel>
              <form action={deleteAction}>
                <input type="hidden" name="id" value={listId} />
                <AlertDialogAction type="submit" disabled={deletePending}>
                  {de.common.delete}
                </AlertDialogAction>
              </form>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}

function AddContactSearch({ listId }: { listId: string }) {
  const [term, setTerm] = useState("");
  const [hits, setHits] = useState<ContactHit[]>([]);
  const [searching, startSearch] = useTransition();
  const [adding, startAdd] = useTransition();

  useEffect(() => {
    if (term.trim().length < 2) return;
    const handle = setTimeout(() => {
      startSearch(async () => {
        const result = await searchContactsAction(term.trim());
        setHits(result);
      });
    }, 300);
    return () => clearTimeout(handle);
  }, [term]);

  const onTermChange = (value: string) => {
    setTerm(value);
    if (value.trim().length < 2) setHits([]);
  };

  const add = (contactId: string) => {
    const fd = new FormData();
    fd.set("listId", listId);
    fd.set("contactId", contactId);
    startAdd(async () => {
      const result = await addListEntryAction(null, fd);
      if (result.ok) {
        toast.success(de.leadLists.contactAdded);
        setTerm("");
        setHits([]);
      } else {
        toast.error(result.error);
      }
    });
  };

  return (
    <div className="relative max-w-md">
      <Input
        type="search"
        value={term}
        onChange={(e) => onTermChange(e.target.value)}
        placeholder={de.leadLists.searchToAdd}
        aria-label={de.leadLists.addContacts}
      />
      {hits.length > 0 ? (
        <ul className="bg-popover absolute z-10 mt-1 w-full rounded-md border shadow-md">
          {hits.map((hit) => (
            <li key={hit.id}>
              <button
                type="button"
                disabled={adding || searching}
                onClick={() => add(hit.id)}
                className="hover:bg-muted flex w-full items-center gap-2 px-3 py-2 text-left text-sm"
              >
                <UserPlus className="text-muted-foreground size-3.5" aria-hidden />
                <span className="truncate">
                  {[hit.first_name, hit.last_name].filter(Boolean).join(" ") || hit.company}
                  {hit.company && (hit.first_name || hit.last_name) ? ` · ${hit.company}` : ""}
                  <span className="text-muted-foreground"> · {hit.city}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function RemoveEntryButton({ entryId, listId }: { entryId: string; listId: string }) {
  const [state, formAction, pending] = useActionState(removeListEntryAction, null);

  useEffect(() => {
    if (state?.ok) toast.success(de.leadLists.contactRemoved);
    else if (state && !state.ok && state.error) toast.error(state.error);
  }, [state]);

  return (
    <form action={formAction} className="inline">
      <input type="hidden" name="entryId" value={entryId} />
      <input type="hidden" name="listId" value={listId} />
      <Button
        type="submit"
        variant="ghost"
        size="icon-sm"
        className="text-destructive"
        disabled={pending}
        aria-label={de.leadLists.removeEntry}
      >
        <Trash2 className="size-3.5" />
      </Button>
    </form>
  );
}
