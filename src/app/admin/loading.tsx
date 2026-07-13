import { Skeleton } from "@/components/ui/skeleton";

/**
 * Route-group loading boundary: paints instantly on navigation while the
 * server component streams in — every click gets immediate feedback.
 */
export default function AppLoading() {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-80" />
      </div>
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}
