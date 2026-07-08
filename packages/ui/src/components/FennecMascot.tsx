import React from "react";
import { FennecMark } from "./FennecMark";

interface FennecMascotProps {
  size?: number;
  className?: string;
  message?: string;
}

/**
 * Empty-state mascot — the Fennex fennec mark rendered large in a soft brand
 * tint. Colour comes from `currentColor` (see FennecMark), tinted here via the
 * text colour utility so it sits quietly in empty states.
 */
export function FennecMascot({ size = 80, className = "", message }: FennecMascotProps) {
  return (
    <div className={`flex flex-col items-center gap-3 ${className}`}>
      <FennecMark size={size} className="opacity-80 dark:opacity-90 dark:invert" title="Fennex" />
      {message && <p className="text-center text-sm text-muted-foreground">{message}</p>}
    </div>
  );
}
