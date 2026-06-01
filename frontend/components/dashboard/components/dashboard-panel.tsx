import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function DashboardPanel({
  actions,
  children,
  className,
  eyebrow,
  subtitle,
  title,
}: {
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  eyebrow: string;
  subtitle?: string;
  title: string;
}) {
  return (
    <section
      className={cn(
        "min-w-0 w-full max-w-full overflow-hidden rounded-2xl border border-border bg-card p-4 text-foreground shadow-sm sm:p-5",
        className,
      )}
    >
      <div className="mb-4 flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">{eyebrow}</p>
          <h2 className="mt-2 min-w-0 break-words text-lg font-semibold tracking-tight text-foreground">{title}</h2>
          {subtitle ? <p className="mt-1 min-w-0 break-words text-xs text-muted-foreground">{subtitle}</p> : null}
        </div>
        {actions ? <div className="ml-auto min-w-0 max-w-full">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}
