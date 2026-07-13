"use client";

import { useTranslation } from "react-i18next";
import {
  Bold, Italic, Code, Link2, Heading2, Heading3, Quote, List, ListOrdered,
  type LucideIcon,
} from "lucide-react";
import type { MdAction } from "@/lib/markdown-edit";

const GROUPS: { action: MdAction; Icon: LucideIcon }[][] = [
  [
    { action: "bold", Icon: Bold },
    { action: "italic", Icon: Italic },
    { action: "code", Icon: Code },
    { action: "link", Icon: Link2 },
  ],
  [
    { action: "h2", Icon: Heading2 },
    { action: "h3", Icon: Heading3 },
  ],
  [
    { action: "ul", Icon: List },
    { action: "ol", Icon: ListOrdered },
    { action: "quote", Icon: Quote },
  ],
];

/**
 * Markdown formatting toolbar for the editor. Each button applies a transform
 * to the current textarea selection via the parent's onFormat handler; the
 * parent flashes and re-selects the changed range.
 */
export function FormatToolbar({ onFormat }: { onFormat: (action: MdAction) => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-1 px-5 py-1.5">
      {GROUPS.map((group, gi) => (
        <div key={gi} className="flex items-center gap-0.5">
          {gi > 0 && <span className="mx-1 h-4 w-px bg-border" />}
          {group.map(({ action, Icon }) => (
            <button
              key={action}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onFormat(action)}
              title={t(`articleStudio.format.${action}`)}
              aria-label={t(`articleStudio.format.${action}`)}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground transition-all hover:bg-accent hover:text-foreground active:scale-90"
            >
              <Icon className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
