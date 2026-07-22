"use client";

import { useEffect, useRef, useState, type CSSProperties, type ElementType, type ReactNode } from "react";

interface RevealProps {
  children: ReactNode;
  /** Stagger delay in ms (applied via the --reveal-delay CSS var). */
  delay?: number;
  /** Render as a different element (e.g. "li", "section"). Defaults to "div". */
  as?: ElementType;
  className?: string;
}

/**
 * Fades + rises its children into view the first time they enter the viewport.
 * Pairs with the `.reveal` / `.is-visible` classes in globals.css and is a no-op
 * under `prefers-reduced-motion`. Purely presentational — no layout impact.
 */
export function Reveal({ children, delay = 0, as, className = "" }: RevealProps) {
  const Tag = (as ?? "div") as ElementType;
  const ref = useRef<HTMLElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          io.disconnect();
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <Tag
      ref={ref}
      className={`reveal ${visible ? "is-visible" : ""} ${className}`.trim()}
      style={{ "--reveal-delay": `${delay}ms` } as CSSProperties}
    >
      {children}
    </Tag>
  );
}
