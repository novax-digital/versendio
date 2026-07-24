import Image from "next/image";

/**
 * Uniform optical box for integration wordmarks: every logo renders inside
 * the same fixed-height container, capped in height AND width and scaled
 * with object-contain — a wide Zapier wordmark and a compact MOCO mark end
 * up visually equal instead of each dictating its own size.
 */
export function IntegrationLogo({
  src,
  alt,
  className = "",
  size = "md",
}: {
  src: string;
  alt: string;
  className?: string;
  size?: "md" | "lg";
}) {
  const box = size === "lg" ? "h-8" : "h-7";
  return (
    <span className={`flex ${box} w-28 shrink-0 items-center ${className}`}>
      <Image
        src={src}
        alt={alt}
        width={112}
        height={32}
        className="max-h-full w-auto max-w-full object-contain object-left"
      />
    </span>
  );
}
