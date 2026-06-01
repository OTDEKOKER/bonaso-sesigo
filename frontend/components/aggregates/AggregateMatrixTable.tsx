"use client";

import React from "react";
import { BarChart3, Table2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AYP_BAND_LABEL,
  buildDisplayMatrix,
  computeAyp,
  getAggregateEntryMatrixConfig,
  getAggregateTotal,
  getBandsForTotals,
  getIndicatorDisaggregateGroups,
  getPeriodLabel,
  getPrimaryDisaggregateLabel,
  mergeDisaggregatesForGroup,
  normalizeMatrixDisaggregatesForIndicator,
  sumBands,
  toSafeNumber,
  type AggregateIndicatorGroup,
  type IndicatorDisaggregationInput,
} from "@/lib/aggregates/aggregate-helpers";

const matrixColumnWidths = {
  keyPopulation: 96,
  ageSex: 72,
  metric: 56,
};

type AggregateMatrixTableProps = {
  aggregateGroups: AggregateIndicatorGroup[];
  projectNameById: Map<string, string>;
  indicatorById: Map<string, IndicatorDisaggregationInput>;
  onViewChart: (group: AggregateIndicatorGroup) => void;
};

function summarizeGroupContext(group: AggregateIndicatorGroup, projectNameById: Map<string, string>) {
  const projectNames = Array.from(
    new Set(
      group.items.map(
        (item) =>
          item.project_name ||
          projectNameById.get(String(item.project)) ||
          "Project",
      ),
    ),
  );

  const organizationNames = Array.from(
    new Set(
      group.items
        .map((item) => item.organization_name || "")
        .filter((name) => name.length > 0),
    ),
  );

  const periodLabels = Array.from(new Set(group.items.map((item) => getPeriodLabel(item))));
  const totalValue = group.items.reduce((sum, item) => sum + getAggregateTotal(item), 0);

  return {
    projectLabel:
      projectNames.length === 1 ? projectNames[0] : `${projectNames.length} projects`,
    organizationLabel:
      organizationNames.length === 1
        ? organizationNames[0]
        : `${organizationNames.length} organizations`,
    periodLabel:
      periodLabels.length === 1 ? periodLabels[0] : `${periodLabels.length} periods`,
    totalValue,
  };
}

function renderSimpleGroupCard(
  group: AggregateIndicatorGroup,
  context: ReturnType<typeof summarizeGroupContext>,
  onViewChart: (group: AggregateIndicatorGroup) => void,
) {
  return (
    <div key={group.key} className="min-w-full rounded-[1.6rem] border border-[#d8dde6] bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs text-[#6b7280]">Indicator</p>
          <p className="text-[1.05rem] font-semibold text-[#0f172a]">{group.indicatorName}</p>
          <p className="text-sm text-[#64748b]">
            {context.organizationLabel} | {context.projectLabel} | {context.periodLabel}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant="outline" className="rounded-full border-[#d8dde6] px-4 py-1 text-base font-semibold text-[#0f172a]">
            Total {Number(context.totalValue).toLocaleString()}
          </Badge>
          <Button
            variant="outline"
            size="sm"
            className="rounded-full border-[#d8dde6] px-4"
            onClick={() => onViewChart(group)}
          >
            <BarChart3 className="mr-2 h-4 w-4" />
            Chart
          </Button>
        </div>
      </div>
    </div>
  );
}

function renderMatrixGroupCard(
  group: AggregateIndicatorGroup,
  context: ReturnType<typeof summarizeGroupContext>,
  disaggregates: NonNullable<ReturnType<typeof mergeDisaggregatesForGroup>>,
  indicatorById: Map<string, IndicatorDisaggregationInput>,
  onViewChart: (group: AggregateIndicatorGroup) => void,
) {
  const indicator = indicatorById.get(group.indicatorId);
  const matrixConfig = getAggregateEntryMatrixConfig(indicator);
  const indicatorGroups = getIndicatorDisaggregateGroups(indicator);
  const primaryDisaggregateLabel = getPrimaryDisaggregateLabel(indicator);
  const alignedDisaggregates = normalizeMatrixDisaggregatesForIndicator(disaggregates, indicator);
  const { matrix, keyPops, secondDimensionValues, ageBands, showAypColumn } =
    buildDisplayMatrix(alignedDisaggregates, indicatorGroups, indicator);

  const safeDimensions = secondDimensionValues.length ? secondDimensionValues : ["All"];
  const safeAgeBands = ageBands.length ? ageBands : ["Value"];
  const visibleAgeBands = safeAgeBands.filter((band) => String(band).toLowerCase() !== "value");
  const showDimensionSummaryRows = keyPops.length > 1 && safeDimensions.length > 1;
  const totalBands = getBandsForTotals(safeAgeBands);
  const dimensionTotals: Record<string, Record<string, number>> = {};
  safeDimensions.forEach((dimension) => {
    dimensionTotals[dimension] = {};
    safeAgeBands.forEach((band) => {
      dimensionTotals[dimension][band] = 0;
    });
    if (showAypColumn) {
      dimensionTotals[dimension][AYP_BAND_LABEL] = 0;
    }
  });

  keyPops.forEach((kp) => {
    const kpData = matrix[kp] || {};
    safeDimensions.forEach((dimension) => {
      const values = kpData[dimension] || {};
      safeAgeBands.forEach((band) => {
        dimensionTotals[dimension][band] += toSafeNumber(values[band]);
      });
      if (showAypColumn) {
        dimensionTotals[dimension][AYP_BAND_LABEL] += computeAyp(values);
      }
    });
  });

  const combinedTotals: Record<string, number> = {};
  safeAgeBands.forEach((band) => {
    combinedTotals[band] = safeDimensions.reduce(
      (sum, dimension) => sum + toSafeNumber(dimensionTotals[dimension]?.[band]),
      0,
    );
  });

  if (showAypColumn) {
    combinedTotals[AYP_BAND_LABEL] = safeDimensions.reduce(
      (sum, dimension) => sum + toSafeNumber(dimensionTotals[dimension]?.[AYP_BAND_LABEL]),
      0,
    );
  }

  const combinedTotal = sumBands(combinedTotals, totalBands);

  return (
    <div key={group.key} className="w-full rounded-[1.6rem] border border-[#d8dde6] bg-white p-3 shadow-sm">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs text-[#6b7280]">Indicator</p>
          <p className="text-[1.05rem] font-semibold text-[#0f172a]">{group.indicatorName}</p>
          <p className="text-sm text-[#64748b]">
            {context.organizationLabel} | {context.projectLabel} | {context.periodLabel}
          </p>
        </div>
        <Badge variant="outline" className="rounded-full border-[#d8dde6] px-4 py-1 text-base font-semibold text-[#0f172a]">
          Total {Number(combinedTotal).toLocaleString()}
        </Badge>
        <Button
          variant="outline"
          size="sm"
          className="rounded-full border-[#d8dde6] px-4"
          onClick={() => onViewChart(group)}
        >
          <BarChart3 className="mr-2 h-4 w-4" />
          Chart
        </Button>
      </div>
      <div className="max-h-[68vh] overflow-auto rounded-[1.25rem] border border-[#d8dde6]">
        <table className="w-max min-w-full table-auto border-separate border-spacing-0 text-sm text-[#1f2937]">
          <thead>
            <tr>
              <th
                className="sticky top-0 z-40 border-b border-r border-[#d8dde6] bg-[#f4f5f7] px-1.5 py-1 text-left font-semibold"
                style={{ minWidth: matrixColumnWidths.keyPopulation, width: matrixColumnWidths.keyPopulation }}
              >
                {primaryDisaggregateLabel}
              </th>
              <th
                className="sticky top-0 z-40 border-b border-r border-[#d8dde6] bg-[#f4f5f7] px-1.5 py-1 text-left font-semibold"
                style={{ minWidth: matrixColumnWidths.ageSex, width: matrixColumnWidths.ageSex }}
              >
                {matrixConfig.secondaryLabel || "Category"}
              </th>
              {visibleAgeBands.map((band) => (
                <th
                  key={band}
                  className="sticky top-0 z-30 border-b border-r border-[#d8dde6] bg-[#f4f5f7] px-1 py-1 text-center font-semibold whitespace-nowrap"
                  style={{ minWidth: matrixColumnWidths.metric }}
                >
                  {band}
                </th>
              ))}
              <th
                className="sticky top-0 z-30 border-b border-r border-[#d8dde6] bg-[#f4f5f7] px-1 py-1 text-center font-semibold whitespace-nowrap"
                style={{ minWidth: matrixColumnWidths.metric }}
              >
                TOTAL
              </th>
              {showAypColumn ? (
                <th
                  className="sticky top-0 z-30 border-b border-r border-[#d8dde6] bg-[#f4f5f7] px-1 py-1 text-center font-semibold whitespace-normal break-words leading-tight"
                  style={{ minWidth: matrixColumnWidths.metric }}
                >
                  {AYP_BAND_LABEL}
                </th>
              ) : null}
            </tr>
          </thead>

          <tbody>
            {keyPops.map((kp, kpIndex) => {
              const kpData = matrix[kp] || {};
              return (
                <React.Fragment key={kp}>
                  {safeDimensions.map((dimension, dimensionIndex) => {
                    const values = kpData[dimension] || {};
                    const total = sumBands(values, totalBands);
                    const ayp = showAypColumn ? computeAyp(values) : 0;
                    const rowIndex = kpIndex * safeDimensions.length + dimensionIndex;
                    const rowBaseClass = rowIndex % 2 === 0 ? "bg-white" : "bg-[#fbfcfd]";

                    return (
                      <tr key={`${kp}-${dimension}`} className={rowBaseClass}>
                        {dimensionIndex === 0 ? (
                          <td
                            className={`border-b border-r border-[#d8dde6] px-1.5 py-1.5 align-top font-semibold whitespace-normal break-words ${rowBaseClass}`}
                            rowSpan={safeDimensions.length}
                            style={{
                              minWidth: matrixColumnWidths.keyPopulation,
                              width: matrixColumnWidths.keyPopulation,
                            }}
                          >
                            {kp}
                          </td>
                        ) : null}

                        <td
                          className={`border-b border-r border-[#d8dde6] px-1.5 py-1.5 whitespace-normal break-words ${rowBaseClass}`}
                          style={{ minWidth: matrixColumnWidths.ageSex, width: matrixColumnWidths.ageSex }}
                        >
                          {dimension}
                        </td>

                        {visibleAgeBands.map((band) => (
                          <td
                            key={`${kp}-${dimension}-${band}`}
                            className={`border-b border-r border-[#d8dde6] px-1 py-1.5 text-center whitespace-nowrap tabular-nums ${rowBaseClass}`}
                          >
                            {toSafeNumber(values[band]).toLocaleString()}
                          </td>
                        ))}

                        <td
                          className={`border-b border-r border-[#d8dde6] px-1 py-1.5 text-center font-semibold whitespace-nowrap tabular-nums ${rowBaseClass}`}
                        >
                          {total.toLocaleString()}
                        </td>

                        {showAypColumn ? (
                          <td
                            className={`border-b border-r border-[#d8dde6] px-1 py-1.5 text-center whitespace-nowrap tabular-nums ${rowBaseClass}`}
                          >
                            {ayp.toLocaleString()}
                          </td>
                        ) : null}
                      </tr>
                    );
                  })}
                </React.Fragment>
              );
            })}

            <tr className="bg-[#f5f7fa] font-semibold">
              <td
                className="border-b border-r border-[#d8dde6] bg-[#f5f7fa] px-1.5 py-1.5 whitespace-normal break-words"
                style={{
                  minWidth: matrixColumnWidths.keyPopulation,
                  width: matrixColumnWidths.keyPopulation,
                }}
              >
                All
              </td>
              <td
                className="border-b border-r border-[#d8dde6] bg-[#f5f7fa] px-1.5 py-1.5 whitespace-normal break-words"
                style={{ minWidth: matrixColumnWidths.ageSex, width: matrixColumnWidths.ageSex }}
              >
                -
              </td>
              {visibleAgeBands.map((band) => (
                <td key={`total-all-${band}`} className="border-b border-r border-[#d8dde6] px-1 py-1.5 text-center whitespace-nowrap tabular-nums">
                  {combinedTotals[band].toLocaleString()}
                </td>
              ))}
              <td className="border-b border-r border-[#d8dde6] px-1 py-1.5 text-center whitespace-nowrap tabular-nums">
                {combinedTotal.toLocaleString()}
              </td>
              {showAypColumn ? (
                <td className="border-b border-r border-[#d8dde6] px-1 py-1.5 text-center whitespace-nowrap tabular-nums">
                  {toSafeNumber(combinedTotals[AYP_BAND_LABEL]).toLocaleString()}
                </td>
              ) : null}
            </tr>

            {showDimensionSummaryRows
              ? safeDimensions.map((dimension) => {
                  const values = dimensionTotals[dimension] || {};
                  const total = sumBands(values, totalBands);
                  const ayp = toSafeNumber(values[AYP_BAND_LABEL]);

                  return (
                    <tr key={`total-${dimension}`} className="bg-[#eef2f7] font-semibold">
                      <td
                        className="border-b border-r border-[#d8dde6] bg-[#eef2f7] px-1.5 py-1.5 whitespace-normal break-words"
                        style={{
                          minWidth: matrixColumnWidths.keyPopulation,
                          width: matrixColumnWidths.keyPopulation,
                        }}
                      >
                        All
                      </td>
                      <td
                        className="border-b border-r border-[#d8dde6] bg-[#eef2f7] px-1.5 py-1.5 whitespace-normal break-words"
                        style={{ minWidth: matrixColumnWidths.ageSex, width: matrixColumnWidths.ageSex }}
                      >
                        {dimension}
                      </td>
                      {visibleAgeBands.map((band) => (
                        <td key={`total-${dimension}-${band}`} className="border-b border-r border-[#d8dde6] px-1 py-1.5 text-center whitespace-nowrap tabular-nums">
                          {toSafeNumber(values[band]).toLocaleString()}
                        </td>
                      ))}
                      <td className="border-b border-r border-[#d8dde6] px-1 py-1.5 text-center whitespace-nowrap tabular-nums">
                        {total.toLocaleString()}
                      </td>
                      {showAypColumn ? (
                        <td className="border-b border-r border-[#d8dde6] px-1 py-1.5 text-center whitespace-nowrap tabular-nums">
                          {ayp.toLocaleString()}
                        </td>
                      ) : null}
                    </tr>
                  );
                })
              : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function AggregateMatrixTable(props: AggregateMatrixTableProps) {
  const { aggregateGroups, projectNameById, indicatorById, onViewChart } = props;

  return (
    <div className="space-y-6">
      {aggregateGroups.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-[1.6rem] border border-[#d8dde6] bg-white py-12 text-center shadow-sm">
          <Table2 className="mb-4 h-12 w-12 text-muted-foreground/50" />
          <h3 className="text-lg font-semibold">No data found</h3>
          <p className="mt-1 text-muted-foreground">Try adjusting your filters or add new entries</p>
        </div>
      ) : (
        aggregateGroups.map((group) => {
          const disaggregates = mergeDisaggregatesForGroup(group.items);
          const context = summarizeGroupContext(group, projectNameById);

          if (!disaggregates) {
            return renderSimpleGroupCard(group, context, onViewChart);
          }

          return renderMatrixGroupCard(
            group,
            context,
            disaggregates,
            indicatorById,
            onViewChart,
          );
        })
      )}
    </div>
  );
}
