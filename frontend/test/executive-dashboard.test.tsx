import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// Mock the data hook so the page renders from a fixture (no API/DB/auth needed).
// The RAG status pills below still exercise the REAL performance-status engine.
vi.mock("@/lib/executive/use-executive-data", () => ({
  DEFAULT_EXECUTIVE_FILTERS: {
    projectId: "all", coordinatorId: "all", organizationId: "all",
    district: "all", indicatorId: "all", dateFrom: "", dateTo: "",
  },
  useExecutiveData: () => ({
    isLoading: false,
    hasError: false,
    indicatorMetrics: [
      { indicatorId: "1", label: "HIV tests conducted", value: 850, target: 1000, percentage: 85 },
      { indicatorId: "2", label: "Condoms distributed", value: 300, target: 1000, percentage: 30 },
    ],
    kpis: {
      overallPct: 74,
      overallStatus: { status: "at-risk", label: "At risk", color: "#F59E0B" },
      targetedOverall: true,
      onTrack: 2,
      indicatorsTargeted: 4,
      indicatorCount: 4,
      totalAchieved: 2950,
      totalTarget: 4000,
      reportingOrganizations: 7,
      scopedOrgCount: 7,
    },
    options: { projects: [], coordinators: [], organizations: [], districts: [], indicators: [] },
  }),
}));

import ExecutiveDashboardPage from "@/app/(dashboard)/executive/page";

describe("ExecutiveDashboardPage", () => {
  it("renders KPI cards from the scoped data", () => {
    render(<ExecutiveDashboardPage />);
    expect(screen.getByText("Executive Dashboard")).toBeTruthy();
    expect(screen.getByText("74%")).toBeTruthy();            // Overall Achievement
    expect(screen.getByText("2 / 4")).toBeTruthy();          // Indicators On Track
    expect(screen.getByText("7 / 7")).toBeTruthy();          // Reporting Organisations
    expect(screen.getByText("2,950")).toBeTruthy();          // Total Achieved
  });

  it("renders the Target-vs-Achieved table with RAG status from the real engine", () => {
    render(<ExecutiveDashboardPage />);
    expect(screen.getByText("HIV tests conducted")).toBeTruthy();
    expect(screen.getByText("Condoms distributed")).toBeTruthy();
    // 850/1000 -> On track (from real getPerformanceStatusFromValues); 300/1000 -> Off track
    expect(screen.getAllByText("On track").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Off track").length).toBeGreaterThan(0);
  });
});
