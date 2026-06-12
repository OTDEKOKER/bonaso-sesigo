"use client";

import { useState } from "react";
import { Download } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { exportChartToExcel, type ChartExportSpec } from "@/lib/chart-export";

/**
 * Reusable "Export Excel" button for analysis charts. The caller supplies the
 * chart spec (or a function returning it, so the spec is built lazily from the
 * latest data). Produces a donor/M&E-style workbook with an embedded Excel
 * chart whose colours come from the shared palette — matching the on-screen
 * chart. See lib/chart-export.ts.
 */
export function ChartExcelExportButton({
  spec,
  size = "sm",
  variant = "outline",
  label = "Export Excel",
  className,
}: {
  spec: ChartExportSpec | (() => ChartExportSpec | null | undefined);
  size?: "sm" | "default";
  variant?: "outline" | "ghost" | "secondary" | "default";
  label?: string;
  className?: string;
}) {
  const { toast } = useToast();
  const [exporting, setExporting] = useState(false);

  const handleClick = async () => {
    const resolved = typeof spec === "function" ? spec() : spec;
    if (!resolved || resolved.categories.length === 0 || resolved.series.length === 0) {
      toast({
        title: "Nothing to export",
        description: "This chart has no data for the current filters.",
      });
      return;
    }
    setExporting(true);
    try {
      await exportChartToExcel(resolved);
    } catch (error) {
      toast({
        variant: "destructive",
        title: "Excel export failed",
        description:
          error instanceof Error ? error.message : "Could not export the chart.",
      });
    } finally {
      setExporting(false);
    }
  };

  return (
    <Button
      type="button"
      size={size}
      variant={variant}
      onClick={handleClick}
      disabled={exporting}
      className={className}
    >
      <Download className="mr-2 h-4 w-4" />
      {exporting ? "Exporting…" : label}
    </Button>
  );
}
