"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import { updatePricingAction } from "../actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { de } from "@/lib/i18n/de";

export type PricingOption = {
  id: string;
  option_key: string;
  display_name_de: string;
  kind: string;
  zone: string;
  ek_cents: number | null;
  vk_cents: number;
  active: boolean;
};

export function PricingTable({ options }: { options: PricingOption[] }) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{de.admin.optionLabel}</TableHead>
            <TableHead className="w-28">{de.admin.ekLabel}</TableHead>
            <TableHead className="w-28">{de.admin.vkLabel}</TableHead>
            <TableHead className="w-32">{de.admin.marginLabel}</TableHead>
            <TableHead className="w-20">{de.admin.activeLabel}</TableHead>
            <TableHead className="w-24" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {options.map((option) => (
            <PricingRow key={option.id} option={option} />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

function PricingRow({ option }: { option: PricingOption }) {
  const router = useRouter();
  const [ek, setEk] = useState(option.ek_cents == null ? "" : String(option.ek_cents));
  const [vk, setVk] = useState(String(option.vk_cents));
  const [active, setActive] = useState(option.active);
  const [pending, startTransition] = useTransition();

  const ekNum = ek === "" ? null : Number(ek);
  const vkNum = Number(vk) || 0;
  const marginCents = ekNum == null ? null : vkNum - ekNum;
  const marginPercent = ekNum != null && ekNum > 0 ? ((vkNum - ekNum) / ekNum) * 100 : null;
  const negative = marginCents != null && marginCents < 0;

  const dirty =
    ek !== (option.ek_cents == null ? "" : String(option.ek_cents)) ||
    vk !== String(option.vk_cents) ||
    active !== option.active;

  const save = (allowNegativeMargin = false) => {
    const fd = new FormData();
    fd.set("id", option.id);
    fd.set("ekCents", ek);
    fd.set("vkCents", vk);
    fd.set("active", active ? "true" : "false");
    if (allowNegativeMargin) fd.set("allowNegativeMargin", "true");
    startTransition(async () => {
      const result = await updatePricingAction(null, fd);
      if (result.ok) {
        toast.success(de.admin.pricingSaved);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  };

  // Selling below cost requires an explicit confirmation (server enforces it).
  const onSave = () => {
    if (negative && active) {
      if (window.confirm(`${de.admin.marginNegativeBlocked}\n\n${de.admin.allowNegativeMargin}?`)) {
        save(true);
      }
      return;
    }
    save();
  };

  return (
    <TableRow>
      <TableCell>
        <span className="font-medium">{option.display_name_de}</span>
        <span className="text-muted-foreground block font-mono text-xs">{option.option_key}</span>
      </TableCell>
      <TableCell>
        <Input
          inputMode="numeric"
          value={ek}
          onChange={(e) => setEk(e.target.value)}
          placeholder="TODO"
          aria-label={`${de.admin.ekLabel} ${option.display_name_de}`}
        />
      </TableCell>
      <TableCell>
        <Input
          inputMode="numeric"
          value={vk}
          onChange={(e) => setVk(e.target.value)}
          aria-label={`${de.admin.vkLabel} ${option.display_name_de}`}
        />
      </TableCell>
      <TableCell>
        {ekNum == null ? (
          <Badge variant="secondary">{de.admin.ekMissing}</Badge>
        ) : (
          <span className={negative ? "text-destructive text-sm font-medium" : "text-sm"}>
            {negative ? (
              <AlertTriangle className="mr-1 inline size-3.5" aria-hidden />
            ) : null}
            {marginCents} ct
            {marginPercent != null ? ` (${marginPercent.toFixed(0)} %)` : ""}
          </span>
        )}
        {negative ? (
          <span className="text-destructive block text-xs">{de.admin.marginNegative}</span>
        ) : null}
      </TableCell>
      <TableCell>
        <Switch
          checked={active}
          onCheckedChange={setActive}
          aria-label={`${de.admin.activeLabel} ${option.display_name_de}`}
        />
      </TableCell>
      <TableCell>
        <Button size="sm" onClick={onSave} disabled={pending || !dirty}>
          {de.common.save}
        </Button>
      </TableCell>
    </TableRow>
  );
}
