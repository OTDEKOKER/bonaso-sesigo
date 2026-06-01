"use client";

export type ReportValueCell = {
  hasData: boolean;
  value: number | null;
  displayValue?: string;
};

export type ReportTableRow = {
  label: string;
  color?: string;
  cells: ReportValueCell[];
};

type ReportDataTableProps = {
  columnLabels: string[];
  rows: ReportTableRow[];
  titleColumnLabel?: string;
  className?: string;
};

const formatNumber = (value: number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);

export function ReportDataTable(props: ReportDataTableProps) {
  const { columnLabels, rows, titleColumnLabel = "Indicator / Category", className } = props;

  return (
    <div className={className ? className : "overflow-x-auto border border-[#c6c6c6]"}>
      <table className="w-full min-w-[760px] border-collapse text-[12px] text-[#4b5563]">
        <thead>
          <tr className="bg-[#f8f8f8]">
            <th className="border border-[#d4d4d4] px-3 py-2 text-left font-medium">{titleColumnLabel}</th>
            {columnLabels.map((columnLabel) => (
              <th key={`header-${columnLabel}`} className="border border-[#d4d4d4] px-3 py-2 text-right font-medium">
                {columnLabel}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`row-${row.label}`}>
              <td className="border border-[#d4d4d4] px-3 py-2">
                <span className="inline-flex items-center gap-2">
                  {row.color ? <span className="h-2.5 w-2.5 rounded-none" style={{ backgroundColor: row.color }} /> : null}
                  {row.label}
                </span>
              </td>
              {row.cells.map((cell, index) => (
                <td key={`${row.label}-${index}`} className="border border-[#d4d4d4] px-3 py-2 text-right tabular-nums">
                  {!cell.hasData ? "\u2014" : (cell.displayValue ?? formatNumber(cell.value ?? 0))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}


