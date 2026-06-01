"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { BarChart3, FileSpreadsheet, LayoutDashboard, List } from "lucide-react";

const TABS = [
  { href: "/analysis/reports", label: "Reports", icon: FileSpreadsheet },
  { href: "/analysis/dashboards", label: "Dashboards", icon: LayoutDashboard },
  { href: "/analysis/pivot-tables", label: "Pivot Tables", icon: BarChart3 },
  { href: "/analysis/line-lists", label: "Line Lists", icon: List },
];

export default function AnalysisLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "";

  return (
    <div className="flex flex-col gap-0">
      {/* Section header */}
      <div className="mb-2">
        <h1 className="text-2xl font-bold text-foreground">Analysis</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Reports, dashboards, cross-tabs, and row-level data for program performance review.
        </p>
      </div>

      {/* Tab bar */}
      <div className="mb-6 border-b border-border">
        <nav className="-mb-px flex gap-0 overflow-x-auto">
          {TABS.map(({ href, label, icon: Icon }) => {
            const active =
              pathname === href ||
              pathname.startsWith(href + "/") ||
              (href === "/analysis/reports" && (pathname === "/analysis/export" || pathname === "/analysis/lists" || pathname === "/analysis/tables"));
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex shrink-0 items-center gap-2 border-b-2 px-4 py-3 text-sm font-medium transition-colors",
                  active
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </Link>
            );
          })}
        </nav>
      </div>

      {children}
    </div>
  );
}
