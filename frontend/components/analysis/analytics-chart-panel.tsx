"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

import { ChartHeader } from "@/components/analysis/chart-header";
import { ChartExcelExportButton } from "@/components/analysis/chart-excel-export-button";
import {
  type ChartDensity,
  getChartPanelClasses,
  ChartInsightFooter,
  ChartSectionStat,
} from "@/components/analysis/chart-theme";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { ChartExportSpec } from "@/lib/chart-export";

type AnalyticsChartPanelProps = {
  title: string;
  subtitle?: string;
  description?: string;
  children: ReactNode;
  footerText?: string | null;
  density?: ChartDensity;
  actions?: ReactNode;
  emphasized?: boolean;
  /**
   * When provided, the panel header shows a consistent "Export Excel" button
   * that downloads a donor/M&E-style workbook (embedded chart + tables) whose
   * colours match the on-screen chart. Pass a function to build the spec lazily
   * from the latest data.
   */
  excelExport?: ChartExportSpec | (() => ChartExportSpec | null | undefined);
  stats?: Array<{
    label: string;
    value: string;
    tone?: "default" | "success" | "warning";
  }>;
};

export function AnalyticsChartPanel(props: AnalyticsChartPanelProps) {
  const {
    title,
    subtitle,
    description,
    children,
    footerText,
    stats = [],
    density = "normal",
    actions,
    emphasized = false,
    excelExport,
  } = props;

  const panelClasses = getChartPanelClasses(density);

  const headerActions =
    actions || excelExport ? (
      <div className="flex items-center gap-2">
        {actions}
        {excelExport ? <ChartExcelExportButton spec={excelExport} /> : null}
      </div>
    ) : undefined;

  return (
    <Card
      className={cn(
        panelClasses.panel,
        emphasized && "border-primary/50 shadow-md ring-1 ring-primary/10",
      )}
    >
      <CardHeader className={panelClasses.header}>
        <div className="space-y-2">
          <ChartHeader title={title} subtitle={subtitle} rightContent={headerActions} />
          {description ? (
            <div className="max-w-3xl text-[13px] leading-5 text-muted-foreground">
              {description}
            </div>
          ) : null}
        </div>
      </CardHeader>

      <CardContent className={cn(panelClasses.content, "space-y-4")}>
        {stats.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {stats.map((stat, index) => (
              <ChartSectionStat
                key={`${stat.label}-${stat.value}-${index}`}
                label={stat.label}
                value={stat.value}
                tone={stat.tone}
              />
            ))}
          </div>
        ) : null}

        {children}

        {footerText ? <ChartInsightFooter text={footerText} /> : null}
      </CardContent>
    </Card>
  );
}