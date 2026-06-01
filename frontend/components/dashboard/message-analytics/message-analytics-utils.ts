import { toSafeNumber } from "@/components/dashboard/engine/normalize-indicators";

export type MessageAnalyticsRow = {
  messageType: string;
  valuesByOrganization: Record<string, number>;
};

export type MessageAnalyticsSummary = {
  totalReached: number;
  topOrganization: {
    name: string;
    value: number;
    percentage: number;
  };
  topMessageType: {
    name: string;
    value: number;
    percentage: number;
  };
  reportingOrganizations: number;
  averagePerOrganization: number;
};

export type MessageAnalyticsSeries = {
  color: string;
  key: string;
  label: string;
};

export type MessageAnalyticsOrganization = {
  color: string;
  key: string;
  label: string;
};

export type MessageAnalyticsViewMode = "absolute" | "percentage" | "normalized";

export type MessageAnalyticsRankingItem = {
  label: string;
  percentage: number;
  value: number;
};

export type MessageAnalyticsInsights = {
  lowestOrganization: MessageAnalyticsRankingItem | null;
  messageTypesWithAnyZero: string[];
  topMessageType: MessageAnalyticsRankingItem | null;
  topOrganization: MessageAnalyticsRankingItem | null;
};

const organizationPalette = [
  "#0EA5E9",
  "#22C55E",
  "#F59E0B",
  "#A855F7",
  "#14B8A6",
  "#F97316",
  "#64748B",
  "#E11D48",
  "#8B5CF6",
  "#06B6D4",
] as const;

function normalizeText(value: unknown) {
  return String(value || "").trim();
}

function normalizeKey(value: string, fallback: string) {
  const normalized = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

function toShortMessageTypeLabel(value: string) {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (normalized === "number of people reached with hiv messages") {
    return "HIV Messages Reached";
  }
  return value;
}

function uniqueLabels(values: string[]) {
  return Array.from(new Set(values.filter((value) => value.trim().length > 0)));
}

export function buildMessageTypeOrgMatrix(
  rows: Array<Record<string, unknown>>,
  series: MessageAnalyticsSeries[],
): MessageAnalyticsRow[] {
  const organizations = uniqueLabels(rows.map((row) => normalizeText(row.cso)));
  const rowsByOrganization = new Map<string, Record<string, unknown>>();

  rows.forEach((row) => {
    const organization = normalizeText(row.cso);
    if (!organization || rowsByOrganization.has(organization)) return;
    rowsByOrganization.set(organization, row);
  });

  return series.map((seriesItem) => {
    const valuesByOrganization: Record<string, number> = {};

    organizations.forEach((organization) => {
      const sourceRow = rowsByOrganization.get(organization);
      valuesByOrganization[organization] = toSafeNumber(sourceRow?.[seriesItem.key]);
    });

    return {
      messageType: seriesItem.label,
      valuesByOrganization,
    };
  });
}

export function groupMessageDataByOrganization(matrix: MessageAnalyticsRow[]) {
  const allOrganizations = uniqueLabels(
    matrix.flatMap((row) => Object.keys(row.valuesByOrganization || {})),
  );
  const totalReached = matrix.reduce((sum, row) => {
    return sum + Object.values(row.valuesByOrganization || {}).reduce((acc, value) => acc + toSafeNumber(value), 0);
  }, 0);

  return allOrganizations.map((organization) => {
    const valuesByMessageType: Record<string, number> = {};
    let total = 0;

    matrix.forEach((row) => {
      const value = toSafeNumber(row.valuesByOrganization?.[organization]);
      valuesByMessageType[row.messageType] = value;
      total += value;
    });

    return {
      organization,
      percentage: totalReached > 0 ? (total / totalReached) * 100 : 0,
      total,
      valuesByMessageType,
    };
  });
}

export function groupMessageDataByType(matrix: MessageAnalyticsRow[]) {
  const totalReached = matrix.reduce((sum, row) => {
    return sum + Object.values(row.valuesByOrganization || {}).reduce((acc, value) => acc + toSafeNumber(value), 0);
  }, 0);

  return matrix.map((row) => {
    const total = Object.values(row.valuesByOrganization || {}).reduce((sum, value) => sum + toSafeNumber(value), 0);
    return {
      messageType: row.messageType,
      percentage: totalReached > 0 ? (total / totalReached) * 100 : 0,
      total,
      valuesByOrganization: { ...row.valuesByOrganization },
    };
  });
}

export function buildPercentageMatrix(matrix: MessageAnalyticsRow[]): MessageAnalyticsRow[] {
  return matrix.map((row) => {
    const rowTotal = Object.values(row.valuesByOrganization || {}).reduce((sum, value) => sum + toSafeNumber(value), 0);
    const valuesByOrganization: Record<string, number> = {};

    Object.entries(row.valuesByOrganization || {}).forEach(([organization, value]) => {
      const safeValue = toSafeNumber(value);
      valuesByOrganization[organization] = rowTotal > 0 ? (safeValue / rowTotal) * 100 : 0;
    });

    return {
      messageType: row.messageType,
      valuesByOrganization,
    };
  });
}

export function buildNormalizedComparisonMatrix(matrix: MessageAnalyticsRow[]): MessageAnalyticsRow[] {
  const organizationTotals = new Map<string, number>();

  matrix.forEach((row) => {
    Object.entries(row.valuesByOrganization || {}).forEach(([organization, value]) => {
      organizationTotals.set(
        organization,
        toSafeNumber(organizationTotals.get(organization)) + toSafeNumber(value),
      );
    });
  });

  return matrix.map((row) => {
    const valuesByOrganization: Record<string, number> = {};

    Object.entries(row.valuesByOrganization || {}).forEach(([organization, value]) => {
      const total = toSafeNumber(organizationTotals.get(organization));
      valuesByOrganization[organization] = total > 0 ? (toSafeNumber(value) / total) * 100 : 0;
    });

    return {
      messageType: row.messageType,
      valuesByOrganization,
    };
  });
}

export function buildRankedOrganizationTotals(
  matrix: MessageAnalyticsRow[],
  mode: MessageAnalyticsViewMode = "absolute",
): MessageAnalyticsRankingItem[] {
  const grouped = groupMessageDataByOrganization(matrix);

  if (mode === "percentage") {
    return grouped
      .map((item) => ({ label: item.organization, percentage: item.percentage, value: item.percentage }))
      .sort((left, right) => right.value - left.value);
  }

  if (mode === "normalized") {
    const shareMatrix = buildPercentageMatrix(matrix);
    const countsByOrg = new Map<string, number>();
    const totalsByOrg = new Map<string, number>();

    shareMatrix.forEach((row) => {
      Object.entries(row.valuesByOrganization || {}).forEach(([organization, value]) => {
        countsByOrg.set(organization, toSafeNumber(countsByOrg.get(organization)) + 1);
        totalsByOrg.set(
          organization,
          toSafeNumber(totalsByOrg.get(organization)) + toSafeNumber(value),
        );
      });
    });

    return grouped
      .map((item) => {
        const count = toSafeNumber(countsByOrg.get(item.organization));
        const averageShare = count > 0 ? toSafeNumber(totalsByOrg.get(item.organization)) / count : 0;
        return {
          label: item.organization,
          percentage: averageShare,
          value: averageShare,
        };
      })
      .sort((left, right) => right.value - left.value);
  }

  return grouped
    .map((item) => ({ label: item.organization, percentage: item.percentage, value: item.total }))
    .sort((left, right) => right.value - left.value);
}

export function buildRankedMessageTypeTotals(
  matrix: MessageAnalyticsRow[],
  mode: MessageAnalyticsViewMode = "absolute",
): MessageAnalyticsRankingItem[] {
  const grouped = groupMessageDataByType(matrix);

  if (mode === "percentage") {
    return grouped
      .map((item) => ({ label: item.messageType, percentage: item.percentage, value: item.percentage }))
      .sort((left, right) => right.value - left.value);
  }

  if (mode === "normalized") {
    const normalizedMatrix = buildNormalizedComparisonMatrix(matrix);

    return normalizedMatrix
      .map((row) => {
        const values = Object.values(row.valuesByOrganization || {});
        const average = values.length > 0 ? values.reduce((sum, value) => sum + toSafeNumber(value), 0) / values.length : 0;
        return {
          label: row.messageType,
          percentage: average,
          value: average,
        };
      })
      .sort((left, right) => right.value - left.value);
  }

  return grouped
    .map((item) => ({ label: item.messageType, percentage: item.percentage, value: item.total }))
    .sort((left, right) => right.value - left.value);
}

export function getMessageAnalyticsInsights(matrix: MessageAnalyticsRow[]): MessageAnalyticsInsights {
  const rankedOrganizations = buildRankedOrganizationTotals(matrix, "absolute");
  const rankedMessageTypes = buildRankedMessageTypeTotals(matrix, "absolute");

  const messageTypesWithAnyZero = matrix
    .filter((row) => Object.values(row.valuesByOrganization || {}).some((value) => toSafeNumber(value) === 0))
    .map((row) => row.messageType);

  const nonZeroOrganizations = rankedOrganizations.filter((item) => item.value > 0);

  return {
    lowestOrganization:
      nonZeroOrganizations.length > 0
        ? nonZeroOrganizations[nonZeroOrganizations.length - 1]
        : rankedOrganizations[rankedOrganizations.length - 1] || null,
    messageTypesWithAnyZero,
    topMessageType: rankedMessageTypes[0] || null,
    topOrganization: rankedOrganizations[0] || null,
  };
}

export function buildMessageAnalyticsSummary(matrix: MessageAnalyticsRow[]): MessageAnalyticsSummary {
  const groupedByOrganization = groupMessageDataByOrganization(matrix);
  const groupedByType = groupMessageDataByType(matrix);
  const totalReached = groupedByType.reduce((sum, item) => sum + toSafeNumber(item.total), 0);

  const topOrganization = [...groupedByOrganization].sort((left, right) => right.total - left.total)[0] || {
    organization: "-",
    percentage: 0,
    total: 0,
  };
  const topMessageType = [...groupedByType].sort((left, right) => right.total - left.total)[0] || {
    messageType: "-",
    percentage: 0,
    total: 0,
  };

  return {
    averagePerOrganization:
      groupedByOrganization.length > 0 ? totalReached / groupedByOrganization.length : 0,
    reportingOrganizations: groupedByOrganization.filter((item) => item.total > 0).length,
    topMessageType: {
      name: topMessageType.messageType,
      percentage: topMessageType.percentage,
      value: topMessageType.total,
    },
    topOrganization: {
      name: topOrganization.organization,
      percentage: topOrganization.percentage,
      value: topOrganization.total,
    },
    totalReached,
  };
}

export function buildMessageAnalyticsOrganizations(rows: Array<Record<string, unknown>>): MessageAnalyticsOrganization[] {
  const organizations = uniqueLabels(rows.map((row) => normalizeText(row.cso)));

  return organizations.map((label, index) => ({
    color: organizationPalette[index % organizationPalette.length],
    key: normalizeKey(label, `org-${index + 1}`),
    label,
  }));
}

export function sanitizeMessageAnalyticsSeries(series: Array<Record<string, unknown>>): MessageAnalyticsSeries[] {
  return series
    .map((item, index) => {
      const key = normalizeText(item.key);
      const label = normalizeText(item.label);
      if (!key || !label) return null;
      return {
        color: normalizeText(item.color) || organizationPalette[index % organizationPalette.length],
        key,
        label: toShortMessageTypeLabel(label),
      };
    })
    .filter((item): item is MessageAnalyticsSeries => Boolean(item));
}
