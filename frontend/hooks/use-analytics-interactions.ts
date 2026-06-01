"use client";

import { useMemo, useState } from "react";

import type { DrilldownTarget } from "@/lib/visualization/engine";

export type AnalyticsInteractionState = {
  selectedDimension: string | null;
  selectedValue: string | null;
  secondaryDimension: string | null;
  secondaryValue: string | null;
  sourceChartId: string | null;
};

const EMPTY_INTERACTION: AnalyticsInteractionState = {
  selectedDimension: null,
  selectedValue: null,
  secondaryDimension: null,
  secondaryValue: null,
  sourceChartId: null,
};

export function useAnalyticsInteractions() {
  const [interaction, setInteraction] = useState<AnalyticsInteractionState>(EMPTY_INTERACTION);

  const interactionFilters = useMemo(() => {
    if (!interaction.selectedDimension || !interaction.selectedValue) return {};

    return {
      [interaction.selectedDimension]: [interaction.selectedValue],
      ...(interaction.secondaryDimension && interaction.secondaryValue
        ? { [interaction.secondaryDimension]: [interaction.secondaryValue] }
        : {}),
    };
  }, [interaction]);

  const applyInteraction = (sourceChartId: string, target: DrilldownTarget) => {
    setInteraction((current) => {
      const isSameInteraction =
        current.sourceChartId === sourceChartId &&
        current.selectedDimension === target.dimension &&
        current.selectedValue === target.value &&
        (current.secondaryDimension || null) === (target.seriesDimension || null) &&
        (current.secondaryValue || null) === (target.seriesValue || null);

      if (isSameInteraction) return EMPTY_INTERACTION;

      return {
        sourceChartId,
        selectedDimension: target.dimension,
        selectedValue: target.value,
        secondaryDimension: target.seriesDimension || null,
        secondaryValue: target.seriesValue || null,
      };
    });
  };

  const clearInteraction = () => setInteraction(EMPTY_INTERACTION);

  return {
    interaction,
    interactionFilters,
    hasInteraction: Boolean(interaction.selectedDimension && interaction.selectedValue),
    applyInteraction,
    clearInteraction,
  };
}
