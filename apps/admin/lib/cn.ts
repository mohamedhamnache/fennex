import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge conditional class names and resolve Tailwind conflicts. Mirrors
 * `apps/web/lib/cn.ts` exactly. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
