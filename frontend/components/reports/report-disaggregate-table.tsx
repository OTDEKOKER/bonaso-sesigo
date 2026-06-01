"use client";

import { ReportDataTable, type ReportTableRow, type ReportValueCell } from "@/components/reports/report-data-table";

export type ReportDisaggregateRow = {
  label: string;
  color?: string;
  byPeriod: Record<string, ReportValueCell>;
};

type ReportDisaggregateTableProps = {
  title: string;
  periodLabels: string[];
  rows: ReportDisaggregateRow[];
  titleColumnLabel?: string;
};

export function ReportDisaggregateTable(props: ReportDisaggregateTableProps) {
  const { title, periodLabels, rows, titleColumnLabel = "Disaggregate" } = props;

  const tableRows: ReportTableRow[] = rows.map((row) => ({
    label: row.label,
    color: row.color,
    cells: periodLabels.map((periodLabel) => row.byPeriod[periodLabel] || { hasData: false, value: null }),
  }));

  return (
    <section className="space-y-3 border border-[#c6c6c6] bg-white p-4">
      <h3 className="text-[16px] font-semibold leading-tight text-[#1f4e79]">{title}</h3>
      <ReportDataTable
        columnLabels={periodLabels}
        rows={tableRows}
        titleColumnLabel={titleColumnLabel}
      />
    </section>
  );
}

