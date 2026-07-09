import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type FormFieldProps = {
  label: string;
  name: string;
  error?: string;
  hint?: string;
  optionalLabel?: string;
} & React.ComponentProps<typeof Input>;

/** Labeled input with error + hint line, wired for server-action forms. */
export function FormField({
  label,
  name,
  error,
  hint,
  optionalLabel,
  className,
  ...inputProps
}: FormFieldProps) {
  const errorId = `${name}-error`;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>
        {label}
        {optionalLabel ? (
          <span className="text-muted-foreground ml-1 text-xs font-normal">({optionalLabel})</span>
        ) : null}
      </Label>
      <Input
        id={name}
        name={name}
        aria-invalid={!!error}
        aria-describedby={error ? errorId : undefined}
        className={cn(error && "border-destructive", className)}
        {...inputProps}
      />
      {error ? (
        <p id={errorId} className="text-destructive text-sm">
          {error}
        </p>
      ) : hint ? (
        <p className="text-muted-foreground text-xs">{hint}</p>
      ) : null}
    </div>
  );
}
