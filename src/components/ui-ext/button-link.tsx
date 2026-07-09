import Link from "next/link";
import type { VariantProps } from "class-variance-authority";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ButtonLinkProps = React.ComponentProps<typeof Link> &
  VariantProps<typeof buttonVariants>;

/**
 * A navigation link styled as a button. Deliberately NOT `<Button render={<Link/>}>`:
 * that makes Base UI treat the anchor as a button (`role="button"`), which
 * hides it from link semantics for screen readers and assistive navigation.
 * Here the element stays a real `<a>` and only borrows the button styles.
 */
export function ButtonLink({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonLinkProps) {
  return (
    <Link
      data-slot="button-link"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}
