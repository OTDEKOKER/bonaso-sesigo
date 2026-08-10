import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { IndicatorPerformanceTableWidget } from "@/components/dashboard/widgets/indicator-performance-table-widget";
import { IndicatorHeatmapTableWidget } from "@/components/dashboard/widgets/indicator-heatmap-table-widget";
import { IndicatorBarChartWidget } from "@/components/dashboard/widgets/indicator-bar-chart-widget";
import { IndicatorColumnChartWidget } from "@/components/dashboard/widgets/indicator-column-chart-widget";
import { IndicatorProgressWidget } from "@/components/dashboard/widgets/indicator-progress-widget";

// Indicators spanning the RAG bands: 80% (on-track), 20% (off-track), no-target.
const metrics = [
  { indicatorId: "1", label: "People tested for HIV", value: 80, target: 100, percentage: 80 },
  { indicatorId: "2", label: "Condoms distributed", value: 20, target: 100, percentage: 20 },
  { indicatorId: "3", label: "Community meetings", value: 5, target: 0, percentage: 0 },
];

describe("IndicatorPerformanceTableWidget — RAG", () => {
  it("adds a Status column with the right RAG pills by default", () => {
    render(<IndicatorPerformanceTableWidget metrics={metrics} title="Test" />);
    expect(screen.getByText("Status")).toBeTruthy();
    expect(screen.getAllByText("On track").length).toBeGreaterThan(0); // 80%
    expect(screen.getAllByText("Off track").length).toBeGreaterThan(0); // 20%
    expect(screen.getAllByText("No target").length).toBeGreaterThan(0); // target 0
  });

  it("hides the Status column when performanceColors is off (reversible)", () => {
    render(
      <IndicatorPerformanceTableWidget metrics={metrics} title="Test" performanceColors={false} />,
    );
    expect(screen.queryByText("Status")).toBeNull();
    expect(screen.queryByText("On track")).toBeNull();
  });
});

describe("IndicatorBarChartWidget — RAG legend", () => {
  it("shows the 4-step RAG legend + Target by default", () => {
    render(<IndicatorBarChartWidget metrics={metrics} title="Test" />);
    expect(screen.getByText("Met")).toBeTruthy();
    expect(screen.getByText("On track")).toBeTruthy();
    expect(screen.getByText("At risk")).toBeTruthy();
    expect(screen.getByText("Off track")).toBeTruthy();
    expect(screen.getByText("Target")).toBeTruthy();
  });

  it("falls back to the flat Actual/Target legend when performanceColors is off", () => {
    render(<IndicatorBarChartWidget metrics={metrics} title="Test" performanceColors={false} />);
    expect(screen.getByText("Actual")).toBeTruthy();
    expect(screen.getByText("Target")).toBeTruthy();
    expect(screen.queryByText("At risk")).toBeNull();
  });
});

describe("IndicatorColumnChartWidget — RAG legend", () => {
  it("renders the RAG legend by default and mounts without throwing", () => {
    render(<IndicatorColumnChartWidget metrics={metrics} title="Test" />);
    expect(screen.getByText("Met")).toBeTruthy();
    expect(screen.getByText("Off track")).toBeTruthy();
  });
});

describe("IndicatorProgressWidget — RAG progress bars", () => {
  it("uses status-coloured bars (no flat bg-primary) by default", () => {
    const { container } = render(<IndicatorProgressWidget metrics={metrics} title="Test" />);
    // targeted bars render an inline status colour, not the flat primary fill
    expect(container.querySelector(".bg-primary\\/70")).toBeNull();
  });

  it("falls back to the flat primary fill when performanceColors is off", () => {
    const { container } = render(
      <IndicatorProgressWidget metrics={metrics} title="Test" performanceColors={false} />,
    );
    expect(container.querySelector(".bg-primary\\/70")).not.toBeNull();
  });
});

describe("IndicatorHeatmapTableWidget", () => {
  it("renders progress percentages and mounts without throwing", () => {
    render(<IndicatorHeatmapTableWidget metrics={metrics} title="Test" />);
    // 80% and 20% rows are shown (formatPercent -> "80"/"20")
    expect(screen.getByText("80%")).toBeTruthy();
    expect(screen.getByText("20%")).toBeTruthy();
  });
});
