import React from "react";

interface FennecMarkProps {
  size?: number;
  className?: string;
  title?: string;
  /** Public path to the brand image. Defaults to the app's /fennec.png. */
  src?: string;
}

/**
 * Fennex brand mark — the fennec fox logo (transparent PNG, black silhouette).
 * On light surfaces it renders as-is; on the brand gradient add `brightness-0
 * invert` via className to render it white.
 */
export function FennecMark({ size = 24, className = "", title, src = "/fennec.png?v=2" }: FennecMarkProps) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- shared package, no next/image config
    <img
      src={src}
      width={size}
      height={size}
      alt={title ?? ""}
      aria-hidden={title ? undefined : true}
      draggable={false}
      className={`object-contain ${className}`}
    />
  );
}
