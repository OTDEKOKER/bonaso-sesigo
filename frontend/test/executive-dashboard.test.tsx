import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

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
    insights: {
      organizations: [
        { label: "MBGE", value: 920, target: 1000, percentage: 92 },
        { label: "BONELA", value: 640, target: 1000, percentage: 64 },
      ],
      trend: [
        { period: "Q1", HIV: 60 },
        { period: "Q2", HIV: 82 },
      ],
      trendSeries: [{ key: "HIV", label: "HIV testing", color: "#0EA5E9" }],
      reportingOrganizationsCount: 7,
    },
    recentSubmissions: [
      { organization: "TEBELOPELE", indicator: "HIV tests", period: "Q1 2026/27", submittedOn: "2026-05-13", status: "approved" },
    ],
    reportedOrganizations: ["MBGE Core", "BOCHAIP"],
    notReportedOrganizations: ["BOFABONETHA"],
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
    expect(screen.getAllByText("HIV tests conducted").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Condoms distributed").length).toBeGreaterThan(0);
    // 850/1000 -> On track (from real getPerformanceStatusFromValues); 300/1000 -> Off track
    expect(screen.getAllByText("On track").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Off track").length).toBeGreaterThan(0);
  });

  it("renders the Inc 2/3 panels (top orgs, attention, recent submissions)", () => {
    render(<ExecutiveDashboardPage />);
    expect(screen.getByText("Top Performing Organisations")).toBeTruthy();
    expect(screen.getByText("MBGE")).toBeTruthy();
    expect(screen.getByText("Indicators Requiring Attention")).toBeTruthy();
    expect(screen.getByText("Reporting Compliance")).toBeTruthy();
    expect(screen.getByText("Recent Data Submissions")).toBeTruthy();
    expect(screen.getByText("TEBELOPELE")).toBeTruthy();
  });

  it("clicking Reporting Organisations opens a dialog listing reported vs not-reported orgs", () => {
    render(<ExecutiveDashboardPage />);
    fireEvent.click(screen.getByRole("button", { name: "Reporting Organisations" }));
    expect(screen.getByText(/Reported \(2\)/)).toBeTruthy();
    expect(screen.getByText(/Not reported \(1\)/)).toBeTruthy();
    expect(screen.getByText("MBGE Core")).toBeTruthy();
    expect(screen.getByText("BOFABONETHA")).toBeTruthy();
  });
});
