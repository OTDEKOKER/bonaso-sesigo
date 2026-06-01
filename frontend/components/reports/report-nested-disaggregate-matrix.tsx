"use client";

import {
  AYP_BAND_LABEL,
  buildDisplayMatrix,
  computeAyp,
  getAggregateEntryMatrixConfig,
  getBandsForTotals,
  getIndicatorDisaggregateGroups,
  getPrimaryDisaggregateLabel,
  normalizeMatrixDisaggregatesForIndicator,
  sumBands,
  toSafeNumber,
  type IndicatorDisaggregationInput,
  type MatrixDisaggregates,
} from "@/lib/aggregates/aggregate-helpers";

type ReportNestedDisaggregateMatrixProps = {
  title: string;
  disaggregates: MatrixDisaggregates;
  indicator?: IndicatorDisaggregationInput;
  subtitle?: string;
};

const formatNumber = (value: number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);

export function ReportNestedDisaggregateMatrix(props: ReportNestedDisaggregateMatrixProps) {
  const { title, disaggregates, indicator, subtitle } = props;

  const indicatorGroups = getIndicatorDisaggregateGroups(indicator);
  const primaryDisaggregateLabel = getPrimaryDisaggregateLabel(indicator);
  const matrixConfig = getAggregateEntryMatrixConfig(indicator);
  const alignedDisaggregates = normalizeMatrixDisaggregatesForIndicator(disaggregates, indicator);
  const { matrix, keyPops, secondDimensionValues, ageBands, showAypColumn } =
    buildDisplayMatrix(alignedDisaggregates, indicatorGroups, indicator);

  const safeDimensions = secondDimensionValues.length ? secondDimensionValues : ["All"];
  const safeAgeBands = ageBands.length ? ageBands : ["Value"];
  const totalBands = getBandsForTotals(safeAgeBands);
  const primaryTotals: Record<string, number> = {};
  const bandTotals: Record<string, number> = {};
  const secondaryTotals: Record<string, Record<string, number>> = {};

  safeAgeBands.forEach((band) => {
    bandTotals[band] = 0;
  });
  if (showAypColumn) {
    bandTotals[AYP_BAND_LABEL] = 0;
  }

  safeDimensions.forEach((dimension) => {
    secondaryTotals[dimension] = {};
    safeAgeBands.forEach((band) => {
      secondaryTotals[dimension][band] = 0;
    });
    if (showAypColumn) {
      secondaryTotals[dimension][AYP_BAND_LABEL] = 0;
    }
  });

  keyPops.forEach((kp) => {
    const kpData = matrix[kp] || {};
    let kpTotal = 0;

    safeDimensions.forEach((dimension) => {
      const values = kpData[dimension] || {};
      const subtotal = sumBands(values, totalBands);
      kpTotal += subtotal;

      safeAgeBands.forEach((band) => {
        const bandValue = toSafeNumber(values[band]);
        bandTotals[band] += bandValue;
        secondaryTotals[dimension][band] += bandValue;
      });

      if (showAypColumn) {
        const ayp = computeAyp(values);
        bandTotals[AYP_BAND_LABEL] += ayp;
        secondaryTotals[dimension][AYP_BAND_LABEL] += ayp;
      }
    });

    primaryTotals[kp] = kpTotal;
  });

  const grandTotal = keyPops.reduce((sum, kp) => sum + toSafeNumber(primaryTotals[kp]), 0);

  return (
    <section className="space-y-3 border border-[#c6c6c6] bg-white p-4">
      <div className="space-y-1">
        <h3 className="text-[16px] font-semibold leading-tight text-[#1f4e79]">{title}</h3>
        {subtitle ? <p className="text-sm text-[#6b7280]">{subtitle}</p> : null}
      </div>

      <div className="overflow-x-auto border border-[#c6c6c6]">
        <table className="w-full min-w-[1120px] border-collapse text-[12px] text-[#1f2937]">
          <thead>
            <tr className="bg-[#f3f4f6]">
              <th className="border border-[#d4d4d4] px-3 py-2 text-center font-semibold">
                {primaryDisaggregateLabel}
              </th>
              <th className="border border-[#d4d4d4] px-3 py-2 text-center font-semibold">
                {matrixConfig.secondaryLabel || "Category"}
              </th>
              {safeAgeBands.map((band) => (
                <th
                  key={`nested-band-${band}`}
                  className="border border-[#d4d4d4] px-3 py-2 text-center font-semibold whitespace-nowrap"
                >
                  {band}
                </th>
              ))}
              <th className="border border-[#d4d4d4] px-3 py-2 text-center font-semibold whitespace-nowrap">
                Sub-total
              </th>
              <th className="border border-[#d4d4d4] px-3 py-2 text-center font-semibold whitespace-nowrap">
                TOTAL
              </th>
              {showAypColumn ? (
                <th className="border border-[#d4d4d4] px-3 py-2 text-center font-semibold whitespace-nowrap">
                  {AYP_BAND_LABEL}
                </th>
              ) : null}
            </tr>
          </thead>

          <tbody>
            {keyPops.map((kp, kpIndex) => {
              const kpData = matrix[kp] || {};
              const kpTotal = toSafeNumber(primaryTotals[kp]);

              return safeDimensions.map((dimension, dimensionIndex) => {
                const values = kpData[dimension] || {};
                const subtotal = sumBands(values, totalBands);
                const ayp = showAypColumn ? computeAyp(values) : 0;
                const rowShade = (kpIndex + dimensionIndex) % 2 === 0 ? "bg-white" : "bg-[#fafafa]";

                return (
                  <tr key={`${kp}-${dimension}`} className={rowShade}>
                    {dimensionIndex === 0 ? (
                      <td
                        className="border border-[#d4d4d4] px-3 py-2 align-middle text-center font-medium"
                        rowSpan={safeDimensions.length}
                      >
                        {kp}
                      </td>
                    ) : null}

                    <td className="border border-[#d4d4d4] px-3 py-2 text-center">{dimension}</td>

                    {safeAgeBands.map((band) => (
                      <td
                        key={`${kp}-${dimension}-${band}`}
                        className="border border-[#d4d4d4] px-3 py-2 text-right tabular-nums"
                      >
                        {formatNumber(toSafeNumber(values[band]))}
                      </td>
                    ))}

                    <td className="border border-[#d4d4d4] px-3 py-2 text-right font-semibold tabular-nums">
                      {formatNumber(subtotal)}
                    </td>

                    {dimensionIndex === 0 ? (
                      <td
                        className="border border-[#d4d4d4] bg-[#eef4ff] px-3 py-2 text-right font-semibold tabular-nums"
                        rowSpan={safeDimensions.length}
                      >
                        {formatNumber(kpTotal)}
                      </td>
                    ) : null}

                    {showAypColumn ? (
                      <td className="border border-[#d4d4d4] px-3 py-2 text-right tabular-nums">
                        {formatNumber(ayp)}
                      </td>
                    ) : null}
                  </tr>
                );
              });
            })}

            <tr className="bg-[#e5e7eb] font-semibold">
              <td className="border border-[#d4d4d4] px-3 py-2" colSpan={2}>
                Sub-total
              </td>
              {safeAgeBands.map((band) => (
                <td
                  key={`grand-${band}`}
                  className="border border-[#d4d4d4] px-3 py-2 text-right tabular-nums"
                >
                  {formatNumber(toSafeNumber(bandTotals[band]))}
                </td>
              ))}
              <td className="border border-[#d4d4d4] px-3 py-2 text-right tabular-nums">
                {formatNumber(grandTotal)}
              </td>
              <td className="border border-[#d4d4d4] px-3 py-2 text-right tabular-nums">
                {formatNumber(grandTotal)}
              </td>
              {showAypColumn ? (
                <td className="border border-[#d4d4d4] px-3 py-2 text-right tabular-nums">
                  {formatNumber(toSafeNumber(bandTotals[AYP_BAND_LABEL]))}
                </td>
              ) : null}
            </tr>

            {safeDimensions.map((dimension) => {
              const values = secondaryTotals[dimension] || {};
              const total = sumBands(values, totalBands);
              const ayp = showAypColumn ? toSafeNumber(values[AYP_BAND_LABEL]) : 0;

              return (
                <tr key={`secondary-total-${dimension}`} className="bg-[#1f4e79] text-white">
                  <td className="border border-[#d4d4d4] px-3 py-2 font-semibold" colSpan={2}>
                    TOTAL {String(dimension).toUpperCase()}
                  </td>
                  {safeAgeBands.map((band) => (
                    <td
                      key={`secondary-total-${dimension}-${band}`}
                      className="border border-[#d4d4d4] px-3 py-2 text-right tabular-nums"
                    >
                      {formatNumber(toSafeNumber(values[band]))}
                    </td>
                  ))}
                  <td className="border border-[#d4d4d4] px-3 py-2 text-right tabular-nums">
                    {formatNumber(total)}
                  </td>
                  <td className="border border-[#d4d4d4] px-3 py-2 text-right tabular-nums">
                    {formatNumber(total)}
                  </td>
                  {showAypColumn ? (
                    <td className="border border-[#d4d4d4] px-3 py-2 text-right tabular-nums">
                      {formatNumber(ayp)}
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
