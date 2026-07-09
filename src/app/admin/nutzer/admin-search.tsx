"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { de } from "@/lib/i18n/de";

/** Debounced admin user search synced to the `q` URL param. */
export function AdminSearch({ initialValue }: { initialValue: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initialValue);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const handle = setTimeout(() => {
      const params = new URLSearchParams();
      if (value.trim()) params.set("q", value.trim());
      router.replace(`/admin/nutzer${params.size ? `?${params}` : ""}`);
    }, 350);
    return () => clearTimeout(handle);
  }, [value, router]);

  return (
    <div className="relative max-w-sm">
      <Search
        className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2"
        aria-hidden
      />
      <Input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={de.admin.searchUsers}
        className="pl-8"
        aria-label={de.common.search}
      />
    </div>
  );
}
