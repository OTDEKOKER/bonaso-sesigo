"use client";

import type { ConsolidatedMatrixData } from "@/lib/analytics/query-builder";

type ConsolidatedMatrixTableProps = {
  title: string;
  matrix: ConsolidatedMatrixData | null;
  className?: string;
};

const numberFormatter = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

function formatValue(value: number) {
  return numberFormatter.format(Number.isFinite(value) ? value : 0);
}

export function ConsolidatedMatrixTable(props: ConsolidatedMatrixTableProps) {
  const { title, matrix, className } = props;

  if (!matrix || matrix.rowLabels.length === 0 || matrix.columnLabels.length === 0) {
    return (
      <section className={className || "space-y-3 border border-[#c6c6c6] bg-white p-4"}>
        <h3 className="text-[16px] font-semibold leading-tight text-[#1f4e79]">{title}</h3>
        <div className="border border-dashed border-[#d4d4d4] px-4 py-6 text-sm text-[#6b7280]">
          No matrix data available for the selected filters.
        </div>
      </section>
    );
  }

  return (
    <section className={className || "space-y-3 border border-[#c6c6c6] bg-white p-4"}>
      <h3 className="text-[16px] font-semibold leading-tight text-[#1f4e79]">{title}</h3>
      <div className="overflow-x-auto border border-[#c6c6c6]">
        <table className="w-full min-w-[760px] border-collapse text-[12px] text-[#4b5563]">
          <thead>
            <tr className="bg-[#f8f8f8]">
              <th className="border border-[#d4d4d4] px-3 py-2 text-left font-medium">
                {matrix.rowDimensionKey}
              </th>
              {matrix.columnLabels.map((columnLabel) => (
                <th
                  key={`col-${columnLabel}`}
                  className="border border-[#d4d4d4] px-3 py-2 text-right font-medium"
                >
                  {columnLabel}
                </th>
              ))}
              <th className="border border-[#d4d4d4] px-3 py-2 text-right font-semibold">Row total</th>
            </tr>
          </thead>
          <tbody>
            {matrix.rowLabels.map((rowLabel, rowIndex) => (
              <tr key={`row-${rowLabel}`}>
                <td className="border border-[#d4d4d4] px-3 py-2">{rowLabel}</td>
                {matrix.columnLabels.map((_, columnIndex) => (
                  <td
                    key={`${rowLabel}-${columnIndex}`}
                    className="border border-[#d4d4d4] px-3 py-2 text-right tabular-nums"
                  >
                    {formatValue(matrix.cells[rowIndex]?.[columnIndex] || 0)}
                  </td>
                ))}
                <td className="border border-[#d4d4d4] px-3 py-2 text-right font-medium tabular-nums">
                  {formatValue(matrix.rowTotals[rowIndex] || 0)}
                </td>
              </tr>
            ))}
            <tr className="bg-[#f8fafc]">
              <td className="border border-[#d4d4d4] px-3 py-2 font-semibold">Column total</td>
              {matrix.columnTotals.map((columnTotal, index) => (
                <td key={`col-total-${index}`} className="border border-[#d4d4d4] px-3 py-2 text-right font-semibold tabular-nums">
                  {formatValue(columnTotal)}
                </td>
              ))}
              <td className="border border-[#d4d4d4] px-3 py-2 text-right font-semibold tabular-nums">
                {formatValue(matrix.grandTotal)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

