"use client";

import type { ReportValueCell } from "@/components/reports/report-data-table";

type ReportDisaggregateMatrixProps = {
  title: string;
  rowHeaderLabel: string;
  columnLabels: string[];
  columnGroups?: Array<{
    label: string;
    span: number;
  }>;
  rows: Array<{
    label: string;
    cells: ReportValueCell[];
  }>;
};

const formatNumber = (value: number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);

export function ReportDisaggregateMatrix(props: ReportDisaggregateMatrixProps) {
  const { title, rowHeaderLabel, columnLabels, columnGroups = [], rows } = props;
  const hasColumnGroups =
    columnGroups.length > 0 &&
    columnGroups.reduce((sum, group) => sum + Math.max(0, group.span), 0) === columnLabels.length;

  return (
    <section className="space-y-3 border border-[#c6c6c6] bg-white p-4">
      <h3 className="text-[16px] font-semibold leading-tight text-[#1f4e79]">{title}</h3>
      <div className="overflow-x-auto border border-[#c6c6c6]">
        <table className="w-full min-w-[600px] border-collapse text-[12px] text-[#4b5563]">
          <thead>
            {hasColumnGroups ? (
              <tr className="bg-[#f3f4f6]">
                <th className="border border-[#d4d4d4] px-3 py-1.5 text-left font-medium">{rowHeaderLabel}</th>
                {columnGroups.map((group) => (
                  <th
                    key={`matrix-group-${group.label}`}
                    className="border border-[#d4d4d4] px-3 py-1.5 text-center font-medium"
                    colSpan={group.span}
                  >
                    {group.label}
                  </th>
                ))}
              </tr>
            ) : null}
            <tr className="bg-[#f8f8f8]">
              <th className="border border-[#d4d4d4] px-3 py-2 text-left font-medium">{rowHeaderLabel}</th>
              {columnLabels.map((columnLabel) => (
                <th key={`matrix-col-${columnLabel}`} className="border border-[#d4d4d4] px-3 py-2 text-right font-medium">
                  {columnLabel}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`matrix-row-${row.label}`}>
                <td className="border border-[#d4d4d4] px-3 py-2">{row.label}</td>
                {row.cells.map((cell, index) => (
                  <td key={`${row.label}-${index}`} className="border border-[#d4d4d4] px-3 py-2 text-right tabular-nums">
                    {!cell.hasData ? "\u2014" : formatNumber(cell.value ?? 0)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}


