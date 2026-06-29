import Link from "next/link";
import { cn } from "@/lib/cn";

export interface Crumb {
  label: string;
  href?: string;
}

/**
 * Signature page header. A subtle brand gradient-mesh band carries an optional
 * breadcrumb, the title + description, and a right-aligned actions slot so
 * every page reads as the same product.
 */
export function PageHeader({
  title,
  description,
  breadcrumbs,
  actions,
  icon: Icon,
  className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  breadcrumbs?: Crumb[];
  actions?: React.ReactNode;
  icon?: React.ElementType;
  className?: string;
}) {
  return (
    <div className={cn("aurora-header mb-6 px-6 py-5", className)}>
      <div className="relative z-10">
        {breadcrumbs && breadcrumbs.length > 0 && (
          <nav className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            {breadcrumbs.map((c, i) => (
              <span key={i} className="flex items-center gap-1.5">
                {i > 0 && <span className="text-muted-foreground/40">/</span>}
                {c.href ? (
                  <Link href={c.href} className="transition-colors hover:text-foreground">
                    {c.label}
                  </Link>
                ) : (
                  <span className="text-foreground/70">{c.label}</span>
                )}
              </span>
            ))}
          </nav>
        )}

        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3.5">
            {Icon && (
              <span className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl gradient-brand text-white glow-primary">
                <Icon className="h-5 w-5" strokeWidth={1.9} />
              </span>
            )}
            <div>
              <h1 className="font-display text-[28px] font-bold leading-tight tracking-tight text-foreground">
                {title}
              </h1>
              {description && (
                <p className="mt-1 text-sm text-muted-foreground">{description}</p>
              )}
            </div>
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      </div>
    </div>
  );
}
