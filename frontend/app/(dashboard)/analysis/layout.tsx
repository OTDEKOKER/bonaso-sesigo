"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { BarChart3, FileSpreadsheet, LayoutDashboard, List } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";

const TABS = [
  { href: "/analysis/reports", label: "Reports", icon: FileSpreadsheet },
  { href: "/analysis/dashboards", label: "Dashboards", icon: LayoutDashboard },
  { href: "/analysis/visualizer", label: "Create Chart", icon: BarChart3 },
  { href: "/analysis/line-lists", label: "Line Lists", icon: List },
];

export default function AnalysisLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "";

  return (
    <div className="flex flex-col gap-0">
      {/* Section header — shared PageHeader family, consistent with every other module. */}
      <div className="mb-4">
        <PageHeader
          title="Analysis"
          description="Reports, dashboards, point-and-click chart creation, and row-level line lists for program performance review."
        />
      </div>

      {/* Tab bar — sticky directly below the frozen app header so the analysis
          tabs stay reachable while scrolling long dashboards/reports. */}
      <div className="sticky top-[var(--app-header-height)] z-20 mb-6 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/75">
        <nav className="-mb-px flex gap-0 overflow-x-auto">
          {TABS.map(({ href, label, icon: Icon }) => {
            const active =
              pathname === href ||
              pathname.startsWith(href + "/");
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
